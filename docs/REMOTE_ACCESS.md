# Remote Access

E supports secure remote access via Tailscale or SSH tunneling, allowing you to monitor long-running Golem loops, approve pending actions, or interact with agents from a phone or remote machine.

## Security

**All remote connections require authentication**, even when E is running in single-user mode. This ensures your E instance is protected when accessed from outside your local network.

## Configuration

### Environment Variables

- **`E_ALLOWED_ORIGINS`**: Comma-separated list of origins permitted for remote access when TLS is enabled.

  Example:

  ```sh
  E_ALLOWED_ORIGINS=https://my-machine.tail1234.ts.net,https://other-machine.tail5678.ts.net
  ```

- **`TLS_CERT`** and **`TLS_KEY`**: Paths to TLS certificate and key files for HTTPS support.

  Example:

  ```sh
  TLS_CERT=/path/to/cert.pem
  TLS_KEY=/path/to/key.pem
  ```

### Settings UI

Navigate to **Settings > Remote Access** to:

- Enable or disable remote access entirely
- Configure Tailscale serve/funnel
- Generate SSH tunnel commands
- View active connections (local and remote)
- Manage allowed origins

## Methods

### 1. Tailscale Integration

[Tailscale](https://tailscale.com) provides zero-config VPN access to your machines.

#### Prerequisites

1. Install Tailscale on your machine
2. Log in to your Tailscale account

#### Setup

1. Open **Settings > Remote Access** in E
2. Enable "Tailscale Integration"
3. Click "Configure Tailscale Serve" for private access within your Tailscale network
   - OR click "Configure Tailscale Funnel" for public HTTPS access (requires ACL permissions)
4. Copy the generated URL and access E remotely

**Tailscale Serve vs Funnel:**

- **Serve**: Private access within your Tailscale network only. Other devices on your tailnet can access E.
- **Funnel**: Public HTTPS access from anywhere on the internet (requires proper ACL configuration in Tailscale admin console).

#### Stop Tailscale

Click "Stop Tailscale" in Settings to disable the serve/funnel configuration.

### 2. SSH Tunnel

Create an SSH tunnel to securely forward E's port to your remote machine.

#### Setup

1. Open **Settings > Remote Access** in E
2. Enable "SSH Tunnel"
3. Copy the generated SSH command
4. Replace `<your-server-ip>` with your machine's IP address and `user` with your SSH username
5. Run the command on your remote machine:

   ```sh
   ssh -L 3002:localhost:3002 -N -f user@192.168.1.100
   ```

6. Access E at `http://localhost:3002` on your remote machine

## Mobile Access

E is fully responsive and optimized for mobile devices. When accessing E from a phone or tablet:

- The UI adapts to smaller screens with a mobile-first layout
- Touch-optimized controls and gestures
- Bottom navigation bar for easy one-handed use
- Chat, terminal, and sidebar panels are accessible via tabs

### Progressive Web App (PWA)

E can be installed as a PWA on mobile devices for a native app-like experience:

1. Access E via Safari (iOS) or Chrome (Android)
2. Tap the share button and select "Add to Home Screen"
3. Launch E from your home screen like any other app

## Remote Session Indicator

When connected remotely, E displays a **Remote** badge in the top bar, indicating that you're accessing E from outside your local network.

## Connection Monitoring

The Settings > Remote Access panel shows:

- **Active Connections**: Total number of connected clients
- **Remote Connections**: Number of clients connected from outside the local network
- **Client List**: Details of each connection including origin, type (local/remote), and connection time

## Disabling Remote Access

Remote access can be disabled in two ways:

1. **Settings UI**: Uncheck "Enable remote access" in Settings > Remote Access
2. **Database**: Set the `remoteAccessEnabled` setting to `false`

When disabled, all remote connection attempts will be rejected with a 403 error.

## CORS and Origin Validation

E validates the `Origin` header on all requests to prevent unauthorized access:

- **Localhost and LAN**: `localhost`, `127.0.0.1`, `::1`, and private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x) are always allowed
- **Tailscale**: `.ts.net` domains are considered remote
- **Custom Origins**: Set `E_ALLOWED_ORIGINS` to whitelist specific domains when TLS is enabled

## TLS/HTTPS

To enable HTTPS for remote access:

1. Obtain or generate TLS certificates:

   ```sh
   # Self-signed certificate (for testing only)
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
   ```

2. Set environment variables:

   ```sh
   export TLS_CERT=/path/to/cert.pem
   export TLS_KEY=/path/to/key.pem
   export E_ALLOWED_ORIGINS=https://allowed-domain.com
   ```

3. Restart E

E will now serve over HTTPS and validate origins against `E_ALLOWED_ORIGINS`.

## Authentication

Remote access always requires authentication via JWT tokens:

1. If no users exist, you'll be prompted to create an account on first access
2. Log in with your credentials
3. E issues a JWT token stored in localStorage
4. All API requests include the token in the `Authorization: Bearer <token>` header

**Note**: Local connections (localhost/LAN) bypass authentication in single-user mode, but remote connections ALWAYS require authentication for security.

## Troubleshooting

### Tailscale not available

- Ensure Tailscale is installed and logged in
- Run `tailscale status` to verify connection

### SSH tunnel not working

- Verify SSH access to your server machine
- Check that the port (default 3002) is not blocked by a firewall
- Ensure E is running on the server machine

### Remote connection rejected

- Verify remote access is enabled in Settings
- Check that your origin is in `E_ALLOWED_ORIGINS` if using TLS
- Ensure you're authenticated (logged in)

### Connection shows as remote when local

- E determines remote/local status based on the `Origin` header
- Accessing via a domain name (even if local) may be flagged as remote
- Use `localhost` or the LAN IP directly for local access

## Examples

### Tailscale + Mobile

1. Install Tailscale on your phone and computer
2. Configure Tailscale Serve in E Settings
3. Access E from your phone's browser using the Tailscale URL
4. Add to home screen for quick access

### SSH Tunnel + Laptop

1. On your work machine, run E locally
2. Copy the SSH tunnel command from Settings
3. SSH into your work machine from your laptop
4. Access E at `http://localhost:3002` on your laptop

### Public HTTPS Access

1. Generate or obtain SSL certificates
2. Configure Tailscale Funnel with proper ACLs
3. Set `TLS_CERT`, `TLS_KEY`, and `E_ALLOWED_ORIGINS` env vars
4. Access E via the public Tailscale Funnel URL from anywhere
