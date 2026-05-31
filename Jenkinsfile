/**
 * Is a Jenkins agent with the given label online? Used to gate platform
 * build stages so an offline rig (the Windows box sleeping, for example)
 * doesn't stall the whole release — the stage just skips and the release
 * publishes with whatever artifacts made it through.
 *
 * Uses the `nodesByLabel` step from the pipeline-utility-steps plugin,
 * which doesn't require sandbox approval for raw Jenkins API access.
 */
def agentAvailable(String label) {
    try {
        def nodes = nodesByLabel(label: label, offline: false)
        if (!nodes || nodes.isEmpty()) {
            echo "Agent label '${label}' has no online nodes — skipping stage."
            return false
        }
        return true
    } catch (err) {
        echo "agentAvailable('${label}') lookup failed: ${err} — skipping stage."
        return false
    }
}

pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'maude'
        DOCKER_TAG   = "${env.GIT_COMMIT?.take(8) ?: 'latest'}"
        JENKINS_URL  = 'http://localhost:8080'
    }

    // Webhook-driven, no polling. GitHub posts to
    // `${JENKINS_URL}/github-webhook/` on push + tag events; the GitHub
    // plugin matches the event against any job whose SCM URL points at
    // the same repo and fires this trigger. Tag pushes produce a build
    // where `env.TAG_NAME` is set, which gates the release stages.
    triggers {
        githubPush()
    }

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    stages {
        stage('Install') {
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                sh '''
                    export PATH="$HOME/.bun/bin:$PATH"
                    # Reinstall only if bun is missing OR present-but-broken (a
                    # prior interrupted install can leave ~/.bun half-extracted).
                    # `command -v` alone isn't enough — verify it actually runs.
                    if ! bun --version >/dev/null 2>&1; then
                        rm -rf "$HOME/.bun"
                        curl -fsSL https://bun.sh/install | bash
                        export PATH="$HOME/.bun/bin:$PATH"
                    fi
                    bun --version
                    bun install --frozen-lockfile
                '''
            }
        }

        stage('Check & Test') {
            options { timeout(time: 10, unit: 'MINUTES') }
            parallel {
                stage('Type Check') {
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$PATH:./node_modules/.bin"
                            npx nx run-many --target=check
                        '''
                    }
                }
                stage('Tests') {
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$PATH:./node_modules/.bin"
                            npx nx run-many --target=test
                        '''
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'test-results.xml'
                        }
                    }
                }
            }
        }

        stage('Docker Build') {
            options { timeout(time: 15, unit: 'MINUTES') }
            steps {
                sh """
                    docker build \
                        --build-arg BUILDKIT_INLINE_CACHE=1 \
                        -t ${DOCKER_IMAGE}:${DOCKER_TAG} \
                        -t ${DOCKER_IMAGE}:latest \
                        .
                """
            }
        }

        stage('Docker Deploy') {
            when {
                anyOf {
                    branch 'main'
                    buildingTag()
                }
            }
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                sh """
                    # Stop existing container if running
                    docker stop maude-app 2>/dev/null || true
                    docker rm maude-app 2>/dev/null || true

                    # Run new container
                    docker run -d \
                        --name maude-app \
                        --restart unless-stopped \
                        -p 3002:3002 \
                        -v maude-data:/root/.maude \
                        ${DOCKER_IMAGE}:${DOCKER_TAG}

                    # Wait for health check
                    echo "Waiting for health check..."
                    for i in \$(seq 1 30); do
                        if curl -sf http://localhost:3002/health > /dev/null 2>&1; then
                            echo "Health check passed"
                            exit 0
                        fi
                        sleep 2
                    done
                    echo "Health check failed after 60s"
                    docker logs maude-app
                    exit 1
                """
            }
        }

        stage('Golem Docker Build') {
            when {
                anyOf {
                    branch 'main'
                    buildingTag()
                    changeset 'packages/server/src/golem/**'
                    changeset 'Dockerfile.golem'
                }
            }
            options { timeout(time: 30, unit: 'MINUTES') }
            steps {
                sh """
                    # Build the golem container image (multi-arch via buildx)
                    docker buildx create --use --name golem-builder 2>/dev/null || docker buildx use golem-builder
                    docker buildx build -f Dockerfile.golem \
                        --platform linux/amd64,linux/arm64 \
                        -t ghcr.io/e-work/golem:${DOCKER_TAG} \
                        -t ghcr.io/e-work/golem:latest \
                        --push \
                        .
                """
            }
        }

        stage('Desktop Build') {
            when {
                anyOf {
                    branch 'main'
                    buildingTag()
                }
            }
            parallel {
                stage('Linux Desktop') {
                    agent { label 'linux' }
                    options { timeout(time: 30, unit: 'MINUTES') }
                    when {
                        expression { return agentAvailable('linux') }
                    }
                    steps {
                        sh '''
                            sudo apt-get update
                            sudo apt-get install -y \
                                libwebkit2gtk-4.1-dev \
                                libsoup-3.0-dev \
                                libayatana-appindicator3-dev \
                                librsvg2-dev \
                                patchelf \
                                libgtk-3-dev \
                                libjavascriptcoregtk-4.1-dev
                        '''
                        sh '''
                            export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"

                            if ! command -v bun >/dev/null 2>&1; then
                                curl -fsSL https://bun.sh/install | bash
                            fi

                            if ! command -v rustup >/dev/null 2>&1; then
                                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
                            fi

                            if ! command -v cargo-tauri >/dev/null 2>&1; then
                                cargo install tauri-cli --locked
                            fi

                            bun install --frozen-lockfile
                            cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb,rpm
                        '''
                        stash includes: 'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb', name: 'linux-deb', allowEmpty: true
                        stash includes: 'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/*.rpm', name: 'linux-rpm', allowEmpty: true
                    }
                }

                stage('macOS Desktop') {
                    agent { label 'macos' }
                    options { timeout(time: 30, unit: 'MINUTES') }
                    when {
                        expression { return agentAvailable('macos') }
                    }
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"

                            if ! command -v bun >/dev/null 2>&1; then
                                curl -fsSL https://bun.sh/install | bash
                            fi

                            if ! command -v rustup >/dev/null 2>&1; then
                                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
                            fi

                            if ! command -v cargo-tauri >/dev/null 2>&1; then
                                cargo install tauri-cli --locked
                            fi

                            NATIVE_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
                            bun install --frozen-lockfile
                            cargo tauri build --target "$NATIVE_TRIPLE"
                        '''
                        stash includes: 'src-tauri/target/*/release/bundle/dmg/*.dmg', name: 'macos-dmg', allowEmpty: true
                    }
                }

                stage('Windows Desktop') {
                    agent { label 'windows' }
                    options { timeout(time: 30, unit: 'MINUTES') }
                    // The Windows rig is the one most likely to be offline —
                    // the label check here is what lets a release cut without it.
                    when {
                        expression { return agentAvailable('windows') }
                    }
                    steps {
                        bat '''
                            set PATH=%USERPROFILE%\\.bun\\bin;%USERPROFILE%\\.cargo\\bin;%PATH%

                            where bun >nul 2>&1 || (
                                powershell -Command "irm bun.sh/install.ps1 | iex"
                            )

                            where rustup >nul 2>&1 || (
                                powershell -Command "Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe; .\\rustup-init.exe -y"
                            )

                            cargo install tauri-cli --locked 2>nul || echo tauri-cli already installed

                            bun install --frozen-lockfile
                            cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis,msi
                        '''
                        stash includes: 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe', name: 'windows-exe', allowEmpty: true
                        stash includes: 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi', name: 'windows-msi', allowEmpty: true
                    }
                }
            }
        }

        stage('Standalone Builds') {
            when {
                anyOf {
                    branch 'main'
                    buildingTag()
                }
            }
            parallel {
                stage('Standalone Linux') {
                    agent { label 'linux' }
                    options { timeout(time: 15, unit: 'MINUTES') }
                    when { expression { return agentAvailable('linux') } }
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$PATH"
                            if ! command -v bun >/dev/null 2>&1; then
                                curl -fsSL https://bun.sh/install | bash
                            fi
                            bun install --frozen-lockfile
                            bun run build:standalone
                        '''
                        stash includes: 'dist/standalone/e-linux-*.tar.gz', name: 'standalone-linux', allowEmpty: true
                    }
                }

                stage('Standalone macOS') {
                    agent { label 'macos' }
                    options { timeout(time: 15, unit: 'MINUTES') }
                    when { expression { return agentAvailable('macos') } }
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$PATH"
                            if ! command -v bun >/dev/null 2>&1; then
                                curl -fsSL https://bun.sh/install | bash
                            fi
                            bun install --frozen-lockfile
                            bun run build:standalone
                        '''
                        stash includes: 'dist/standalone/e-darwin-*.tar.gz', name: 'standalone-macos', allowEmpty: true
                    }
                }

                stage('Standalone Windows') {
                    agent { label 'windows' }
                    options { timeout(time: 15, unit: 'MINUTES') }
                    when { expression { return agentAvailable('windows') } }
                    steps {
                        bat '''
                            set PATH=%USERPROFILE%\\.bun\\bin;%PATH%
                            where bun >nul 2>&1 || (
                                powershell -Command "irm bun.sh/install.ps1 | iex"
                            )
                            bun install --frozen-lockfile
                            bun run build:standalone
                        '''
                        stash includes: 'dist/standalone/e-windows-*.zip', name: 'standalone-windows', allowEmpty: true
                    }
                }
            }
        }

        stage('Archive') {
            when { buildingTag() }
            steps {
                sh 'rm -rf release-artifacts && mkdir release-artifacts'

                // Unstash whatever was produced. Each stash was declared
                // `allowEmpty: true` and its source stage gated on agent
                // availability, so a missing one just means that platform
                // didn't run this cut — don't fail the release.
                script {
                    ['linux-deb', 'linux-rpm', 'macos-dmg', 'windows-exe', 'windows-msi',
                     'standalone-linux', 'standalone-macos', 'standalone-windows'].each { name ->
                        try {
                            unstash name
                        } catch (err) {
                            echo "Stash '${name}' unavailable — platform build was skipped or produced nothing."
                        }
                    }
                }

                // Collect into release-artifacts/
                sh '''
                    find src-tauri/target -name '*.deb' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.rpm' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.dmg' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.exe' -path '*/nsis/*' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.msi' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    cp dist/standalone/e-*.tar.gz release-artifacts/ 2>/dev/null || true
                    cp dist/standalone/e-*.zip release-artifacts/ 2>/dev/null || true
                    echo "release-artifacts/ contents:"
                    ls -la release-artifacts/
                '''

                archiveArtifacts artifacts: 'release-artifacts/*', fingerprint: true, allowEmptyArchive: true

                sh """
                    docker tag ${DOCKER_IMAGE}:${DOCKER_TAG} ${DOCKER_IMAGE}:${env.TAG_NAME}
                """
            }
        }

        stage('GitHub Release') {
            when { buildingTag() }
            options { timeout(time: 10, unit: 'MINUTES') }
            steps {
                // `github-pat` is the Jenkins-instance-wide GitHub credential,
                // Username/Password type — same one the Parabun pipeline uses.
                // `gh` honors GH_TOKEN from the environment, so we bind the
                // password half to that and leave GH_USER for log context.
                withCredentials([usernamePassword(
                    credentialsId: 'github-pat',
                    usernameVariable: 'GH_USER',
                    passwordVariable: 'GH_TOKEN',
                )]) {
                    sh '''
                        export PATH="$HOME/.bun/bin:$PATH"
                        if ! command -v gh >/dev/null 2>&1; then
                            echo "Installing gh CLI..."
                            type -p curl >/dev/null || sudo apt-get install -y curl
                            curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
                                | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
                            sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
                            echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
                                | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
                            sudo apt-get update && sudo apt-get install -y gh
                        fi

                        # Release notes come from commits since the previous tag.
                        PREV_TAG="$(git describe --tags --abbrev=0 "${TAG_NAME}^" 2>/dev/null || echo '')"
                        NOTES_RANGE="${PREV_TAG:+${PREV_TAG}..${TAG_NAME}}"

                        bun scripts/publish-github-release.ts "${TAG_NAME}" \
                            --artifacts release-artifacts \
                            --repo airgap/E \
                            ${NOTES_RANGE:+--notes-from "${NOTES_RANGE}"}
                    '''
                }
            }
        }

        stage('GitHub Prerelease') {
            // Per-commit prerelease for every successful main build, published
            // alongside the tag-driven stable releases above. GitHub's "latest
            // release" excludes prereleases, so install.sh (which hits
            // /releases/latest) keeps serving the last stable tag — these
            // builds are opt-in via `install.sh build-<sha>`.
            when { branch 'main' }
            options { timeout(time: 10, unit: 'MINUTES') }
            steps {
                sh 'rm -rf release-artifacts && mkdir release-artifacts'

                // Best-effort unstash, same as the tag Archive stage: a platform
                // whose agent was offline simply isn't represented in the build.
                script {
                    ['linux-deb', 'linux-rpm', 'macos-dmg', 'windows-exe', 'windows-msi',
                     'standalone-linux', 'standalone-macos', 'standalone-windows'].each { name ->
                        try {
                            unstash name
                        } catch (err) {
                            echo "Stash '${name}' unavailable — platform build was skipped or produced nothing."
                        }
                    }
                }

                sh '''
                    find src-tauri/target -name '*.deb' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.rpm' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.dmg' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.exe' -path '*/nsis/*' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    find src-tauri/target -name '*.msi' -exec cp {} release-artifacts/ \\; 2>/dev/null || true
                    cp dist/standalone/e-*.tar.gz release-artifacts/ 2>/dev/null || true
                    cp dist/standalone/e-*.zip release-artifacts/ 2>/dev/null || true
                    echo "release-artifacts/ contents:"
                    ls -la release-artifacts/
                '''

                withCredentials([usernamePassword(
                    credentialsId: 'github-pat',
                    usernameVariable: 'GH_USER',
                    passwordVariable: 'GH_TOKEN',
                )]) {
                    sh '''
                        export PATH="$HOME/.bun/bin:$PATH"
                        if [ -z "$(ls -A release-artifacts 2>/dev/null)" ]; then
                            echo "No artifacts produced this build — skipping prerelease."
                            exit 0
                        fi

                        SHORT_SHA=$(git rev-parse --short HEAD)
                        bun scripts/publish-github-release.ts "build-${SHORT_SHA}" \
                            --artifacts release-artifacts \
                            --repo airgap/E \
                            --target "$GIT_COMMIT" \
                            --prerelease \
                            --notes-from "HEAD~1..HEAD" \
                            --prune-prefix "build-" \
                            --prune-keep 10
                    '''
                }
            }
        }

        stage('Upload to R2') {
            when { buildingTag() }
            options { timeout(time: 10, unit: 'MINUTES') }
            environment {
                CLOUDFLARE_API_TOKEN  = credentials('cloudflare-api-token')
                CLOUDFLARE_ACCOUNT_ID = credentials('cloudflare-account-id')
            }
            steps {
                sh '''
                    export PATH="$HOME/.bun/bin:$PATH"
                    bun scripts/upload-release.ts "${TAG_NAME}" --artifacts release-artifacts
                '''
            }
        }

        stage('Deploy Site') {
            when { buildingTag() }
            options { timeout(time: 5, unit: 'MINUTES') }
            environment {
                CLOUDFLARE_API_TOKEN  = credentials('cloudflare-api-token')
                CLOUDFLARE_ACCOUNT_ID = credentials('cloudflare-account-id')
            }
            steps {
                sh '''
                    export PATH="$HOME/.bun/bin:$PATH"
                    wrangler pages deploy site/ --project-name=e-site --commit-dirty=true
                '''
            }
        }
    }

    post {
        failure {
            sh 'echo "Build failed — check ${BUILD_URL}console for details"'
        }
        cleanup {
            sh 'docker image prune -f 2>/dev/null || true'
        }
    }
}
