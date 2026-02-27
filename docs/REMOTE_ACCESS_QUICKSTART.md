# Remote Access Quick Start Guide

## 5-Minute Setup

### Option 1: Tailscale (Recommended)

1. **Install Tailscale** (one-time setup):

   ```bash
   # macOS
   brew install tailscale

   # Ubuntu/Debian
   curl -fsSL https://tailscale.com/install.sh | sh

   # Windows
   # Download from https://tailscale.com/download
   ```

2. **Start Tailscale and log in**:

   ```bash
   tailscale up
   ```

3. **Start E**:

   ```bash
   cd /path/to/maude
   bun run start
   ```

4. **Configure remote access**:
   - Open http://localhost:3002
   - Go to Settings → Remote Access
   - Check "Enable remote access"
   - Click "Configure Tailscale Serve"
   - Copy the generated URL (e.g., `https://my-machine.tail1234.ts.net`)

5. **Access from anywhere**:
   - On your phone/tablet, install Tailscale and log in with the same account
   - Open the Tailscale URL in your mobile browser
   - Log in to E and enjoy!

### Option 2: SSH Tunnel

1. **Start E on your server machine**:

   ```bash
   bun run start
   ```

2. **Get the SSH tunnel command**:
   - Open http://localhost:3002 on the server
   - Go to Settings → Remote Access
   - Enable "SSH Tunnel"
   - Copy the command and replace placeholders:
     ```bash
     ssh -L 3002:localhost:3002 -N -f your-username@192.168.1.100
     ```

3. **Run the SSH tunnel from your remote machine**:

   ```bash
   ssh -L 3002:localhost:3002 -N -f your-username@YOUR-SERVER-IP
   ```

4. **Access E**:
   - Open http://localhost:3002 on your remote machine
   - Log in and use E as if it were local!

## Mobile/PWA Installation

After accessing E remotely:

**iOS (Safari)**:

1. Tap the Share button (box with arrow)
2. Scroll down and tap "Add to Home Screen"
3. Tap "Add"
4. E now appears on your home screen like a native app!

**Android (Chrome)**:

1. Tap the menu button (three dots)
2. Tap "Add to Home Screen" or "Install App"
3. Tap "Add"
4. E is now installed!

## Security Notes

- ✅ All remote connections require authentication (username/password or JWT token)
- ✅ Tailscale uses WireGuard encryption (end-to-end encrypted)
- ✅ SSH tunnels are encrypted by SSH protocol
- ✅ Local connections are allowed without auth in single-user mode
- ✅ You can disable remote access anytime in Settings

## Troubleshooting

**"Tailscale not available"**

- Make sure Tailscale is installed: `which tailscale`
- Make sure you're logged in: `tailscale status`

**"SSH connection refused"**

- Verify SSH is enabled on the server
- Check firewall rules allow SSH (port 22)
- Verify the server IP address is correct

**"Authentication required" on local access**

- This is normal for remote connections
- Create an account or log in
- Your token will be saved in localStorage

**Remote indicator not showing**

- Check if you're accessing via localhost vs. actual IP/domain
- Remote indicator only shows for non-localhost origins

## Advanced: HTTPS with Custom Domain

1. Get SSL certificates (Let's Encrypt, self-signed, etc.)
2. Set environment variables:
   ```bash
   export TLS_CERT=/path/to/cert.pem
   export TLS_KEY=/path/to/key.pem
   export E_ALLOWED_ORIGINS=https://your-domain.com
   ```
3. Restart E
4. Access via https://your-domain.com

## Next Steps

- See [REMOTE_ACCESS.md](REMOTE_ACCESS.md) for comprehensive documentation
- Check connection status in Settings → Remote Access
- Monitor active clients in real-time
- Enjoy E from anywhere! 🚀
