pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'maude'
        DOCKER_TAG   = "${env.GIT_COMMIT?.take(8) ?: 'latest'}"
        JENKINS_URL  = 'http://localhost:8080'
    }

    stages {
        stage('Install') {
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                sh '''
                    export PATH="$HOME/.bun/bin:$PATH"
                    if ! command -v bun &>/dev/null; then
                        curl -fsSL https://bun.sh/install | bash
                        export PATH="$HOME/.bun/bin:$PATH"
                    fi
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

                            if ! command -v bun &>/dev/null; then
                                curl -fsSL https://bun.sh/install | bash
                            fi

                            if ! command -v rustup &>/dev/null; then
                                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
                            fi

                            if ! command -v cargo-tauri &>/dev/null; then
                                cargo install tauri-cli --locked
                            fi

                            bun install --frozen-lockfile
                            cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb,rpm
                        '''
                        stash includes: 'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb', name: 'linux-deb'
                        stash includes: 'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/*.rpm', name: 'linux-rpm'
                    }
                }

                stage('macOS Desktop') {
                    agent { label 'macos' }
                    options { timeout(time: 30, unit: 'MINUTES') }
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"

                            if ! command -v bun &>/dev/null; then
                                curl -fsSL https://bun.sh/install | bash
                            fi

                            if ! command -v rustup &>/dev/null; then
                                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
                            fi

                            if ! command -v cargo-tauri &>/dev/null; then
                                cargo install tauri-cli --locked
                            fi

                            NATIVE_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
                            bun install --frozen-lockfile
                            cargo tauri build --target "$NATIVE_TRIPLE"
                        '''
                        stash includes: 'src-tauri/target/*/release/bundle/dmg/*.dmg', name: 'macos-dmg'
                    }
                }

                stage('Windows Desktop') {
                    agent { label 'windows' }
                    options { timeout(time: 30, unit: 'MINUTES') }
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
                        stash includes: 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe', name: 'windows-exe'
                        stash includes: 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi', name: 'windows-msi'
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
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$PATH"
                            if ! command -v bun &>/dev/null; then
                                curl -fsSL https://bun.sh/install | bash
                            fi
                            bun install --frozen-lockfile
                            bun run build:standalone
                        '''
                        stash includes: 'dist/standalone/e-linux-*', name: 'standalone-linux'
                    }
                }

                stage('Standalone macOS') {
                    agent { label 'macos' }
                    options { timeout(time: 15, unit: 'MINUTES') }
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$PATH"
                            if ! command -v bun &>/dev/null; then
                                curl -fsSL https://bun.sh/install | bash
                            fi
                            bun install --frozen-lockfile
                            bun run build:standalone
                        '''
                        stash includes: 'dist/standalone/e-darwin-*', name: 'standalone-macos'
                    }
                }

                stage('Standalone Windows') {
                    agent { label 'windows' }
                    options { timeout(time: 15, unit: 'MINUTES') }
                    steps {
                        bat '''
                            set PATH=%USERPROFILE%\\.bun\\bin;%PATH%
                            where bun >nul 2>&1 || (
                                powershell -Command "irm bun.sh/install.ps1 | iex"
                            )
                            bun install --frozen-lockfile
                            bun run build:standalone
                        '''
                        stash includes: 'dist/standalone/e-windows-*', name: 'standalone-windows'
                    }
                }
            }
        }

        stage('Archive') {
            when { buildingTag() }
            steps {
                sh 'rm -rf release-artifacts && mkdir release-artifacts'

                // Unstash desktop builds
                unstash 'linux-deb'
                unstash 'linux-rpm'
                unstash 'macos-dmg'
                unstash 'windows-exe'
                unstash 'windows-msi'

                // Unstash standalone builds
                unstash 'standalone-linux'
                unstash 'standalone-macos'
                unstash 'standalone-windows'

                // Collect into release-artifacts/
                sh '''
                    find src-tauri/target -name '*.deb' -exec cp {} release-artifacts/ \\;
                    find src-tauri/target -name '*.rpm' -exec cp {} release-artifacts/ \\;
                    find src-tauri/target -name '*.dmg' -exec cp {} release-artifacts/ \\;
                    find src-tauri/target -name '*.exe' -path '*/nsis/*' -exec cp {} release-artifacts/ \\;
                    find src-tauri/target -name '*.msi' -exec cp {} release-artifacts/ \\;
                    cp dist/standalone/e-* release-artifacts/ 2>/dev/null || true
                '''

                archiveArtifacts artifacts: 'release-artifacts/*', fingerprint: true

                sh """
                    docker tag ${DOCKER_IMAGE}:${DOCKER_TAG} ${DOCKER_IMAGE}:${env.TAG_NAME}
                """
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
