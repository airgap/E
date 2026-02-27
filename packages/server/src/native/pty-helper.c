/**
 * pty-helper — minimal PTY proxy for Bun.
 *
 * Spawns a shell in a PTY and proxies raw I/O:
 *   stdin  (fd 0) → PTY master  (terminal input)
 *   PTY master    → stdout (fd 1)  (terminal output)
 *   fd 3          → control channel (resize commands)
 *
 * Control protocol on fd 3:
 *   [0x01][cols LE16][rows LE16]  = resize (5 bytes)
 *
 * Usage: pty-helper <shell> <cwd> <cols> <rows> [shell-args...]
 * Exit code: child's exit code, or 128+signal if killed.
 */
#include <pty.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/select.h>
#include <sys/ioctl.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>

static volatile pid_t child_pid = -1;
static volatile int child_exited = 0;
static int child_exit_status = 0;

static void sigchld_handler(int sig) {
    (void)sig;
    int status;
    if (waitpid(child_pid, &status, WNOHANG) > 0) {
        child_exited = 1;
        if (WIFEXITED(status))
            child_exit_status = WEXITSTATUS(status);
        else if (WIFSIGNALED(status))
            child_exit_status = 128 + WTERMSIG(status);
    }
}

/* Drain remaining PTY output after child exits */
static void drain_master(int master_fd) {
    char buf[4096];
    struct timeval tv = { .tv_sec = 0, .tv_usec = 50000 }; /* 50ms */
    fd_set rfds;
    for (;;) {
        FD_ZERO(&rfds);
        FD_SET(master_fd, &rfds);
        if (select(master_fd + 1, &rfds, NULL, NULL, &tv) <= 0) break;
        ssize_t n = read(master_fd, buf, sizeof(buf));
        if (n <= 0) break;
        write(STDOUT_FILENO, buf, n);
        tv.tv_sec = 0;
        tv.tv_usec = 10000; /* subsequent drains: 10ms */
    }
}

int main(int argc, char *argv[]) {
    if (argc < 5) {
        fprintf(stderr, "Usage: pty-helper <shell> <cwd> <cols> <rows> [args...]\n");
        return 1;
    }

    const char *shell = argv[1];
    const char *cwd   = argv[2];
    int cols = atoi(argv[3]);
    int rows = atoi(argv[4]);

    /* Build shell args: [shell, extra_args..., NULL] */
    int nargs = argc - 4;
    char **shell_args = calloc(nargs + 1, sizeof(char *));
    shell_args[0] = (char *)shell;
    for (int i = 5; i < argc; i++)
        shell_args[i - 4] = argv[i];
    shell_args[nargs] = NULL;

    struct winsize ws = { .ws_row = rows, .ws_col = cols };
    int master_fd;
    pid_t pid = forkpty(&master_fd, NULL, NULL, &ws);

    if (pid < 0) { perror("forkpty"); return 1; }

    if (pid == 0) {
        /* ── Child ── */
        if (cwd[0]) chdir(cwd);
        execvp(shell, shell_args);
        perror("exec");
        _exit(127);
    }

    /* ── Parent ── */
    child_pid = pid;
    free(shell_args);

    /* SIGCHLD handler */
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = sigchld_handler;
    sa.sa_flags = SA_NOCLDSTOP;
    sigaction(SIGCHLD, &sa, NULL);

    /* Non-blocking I/O */
    fcntl(STDIN_FILENO, F_SETFL, O_NONBLOCK);
    fcntl(master_fd, F_SETFL, O_NONBLOCK);

    /* Control channel (fd 3) — may not exist if parent didn't set it up */
    int ctl_fd = 3;
    int has_ctl = (fcntl(ctl_fd, F_GETFD) >= 0);
    if (has_ctl) fcntl(ctl_fd, F_SETFL, O_NONBLOCK);

    char buf[16384];
    unsigned char ctl_buf[64];

    while (!child_exited) {
        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(STDIN_FILENO, &rfds);
        FD_SET(master_fd, &rfds);
        int maxfd = master_fd;
        if (has_ctl) { FD_SET(ctl_fd, &rfds); if (ctl_fd > maxfd) maxfd = ctl_fd; }

        struct timeval tv = { .tv_sec = 0, .tv_usec = 100000 }; /* 100ms */
        int ret = select(maxfd + 1, &rfds, NULL, NULL, &tv);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }

        /* stdin → PTY */
        if (FD_ISSET(STDIN_FILENO, &rfds)) {
            ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
            if (n > 0) {
                const char *p = buf;
                ssize_t rem = n;
                while (rem > 0) {
                    ssize_t w = write(master_fd, p, rem);
                    if (w < 0) { if (errno == EAGAIN || errno == EINTR) continue; break; }
                    p += w; rem -= w;
                }
            } else if (n == 0) {
                break; /* parent closed stdin */
            }
        }

        /* PTY → stdout */
        if (FD_ISSET(master_fd, &rfds)) {
            ssize_t n = read(master_fd, buf, sizeof(buf));
            if (n > 0) {
                const char *p = buf;
                ssize_t rem = n;
                while (rem > 0) {
                    ssize_t w = write(STDOUT_FILENO, p, rem);
                    if (w < 0) { if (errno == EAGAIN || errno == EINTR) continue; break; }
                    p += w; rem -= w;
                }
            } else if (n <= 0 && errno != EAGAIN) {
                break;
            }
        }

        /* Control channel → resize */
        if (has_ctl && FD_ISSET(ctl_fd, &rfds)) {
            ssize_t n = read(ctl_fd, ctl_buf, sizeof(ctl_buf));
            if (n >= 5 && ctl_buf[0] == 0x01) {
                uint16_t nc = ctl_buf[1] | (ctl_buf[2] << 8);
                uint16_t nr = ctl_buf[3] | (ctl_buf[4] << 8);
                struct winsize nws = { .ws_row = nr, .ws_col = nc };
                ioctl(master_fd, TIOCSWINSZ, &nws);
                /* Notify the child shell of the size change */
                kill(pid, SIGWINCH);
            } else if (n == 0) {
                has_ctl = 0; /* control channel closed */
            }
        }
    }

    drain_master(master_fd);
    close(master_fd);

    if (!child_exited) {
        kill(pid, SIGTERM);
        usleep(100000);
        kill(pid, SIGKILL);
        waitpid(pid, NULL, 0);
    }

    return child_exit_status;
}
