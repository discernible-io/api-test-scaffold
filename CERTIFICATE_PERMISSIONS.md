# Certificate Permission Fix

## Problem
Nginx container was failing to load `privkey.pem` with error:
```
nginx: [emerg] cannot load certificate key "/app/certs/privkey.pem": 
BIO_new_file() failed (SSL: error:8000000D:system library::Permission denied)
```

## Root Cause
- **Host file permissions**: `privkey.pem` has `600` (rw-------) - only owner can read
- **Nginx container user**: Runs as user `nginx` (UID 101)
- **Volume mount**: File mounted as read-only (`:ro,Z`)
- **Result**: Nginx user (UID 101) cannot read file owned by different UID with 600 permissions

## ❌ BAD Solution: chmod 644 (World-Readable)
Making the private key world-readable (`chmod 644`) works but **exposes your private key to all users on the host** - a serious security risk.

## ✅ PROPER Solution: Use podman unshare

The fix uses `podman unshare` to change ownership in the container's user namespace without affecting host security:

```bash
# Set ownership to nginx user (UID 101) in container namespace
podman unshare chown 101:101 ~/clienttestapi-app/certs/privkey.pem
podman unshare chown 101:101 ~/clienttestapi-app/certs/fullchain.pem

# Set restrictive permissions (640 for private key, 644 for public cert)
podman unshare chmod 640 ~/clienttestapi-app/certs/privkey.pem
podman unshare chmod 644 ~/clienttestapi-app/certs/fullchain.pem
```

## Why This Works

1. **podman unshare**: Enters the user namespace where container UIDs are mapped
2. **chown 101:101**: Sets ownership to nginx user (UID 101 in container)
3. **chmod 640**: Private key readable only by owner (nginx) and group
4. **Host security maintained**: On the host, files still appear owned by your user
5. **Container access granted**: Inside container, nginx user (101) can read the files

## Implementation

The fix is applied in two places in `.github/workflows/deploy.yml`:

1. **Line 58-59**: Early setup during file copy phase
2. **Line 184-189**: Just before starting nginx container

This ensures certificates have correct permissions before nginx attempts to load them.

## Security Benefits

✅ Private key NOT world-readable on host
✅ Only nginx container user can read private key
✅ Proper separation of concerns via user namespaces
✅ Follows principle of least privilege
✅ No security warnings from nginx

## Alternative Solutions (Not Recommended)

1. **Run nginx as root**: Security risk, violates least privilege
2. **World-readable certs**: Exposes private key to all host users
3. **Group permissions**: Requires managing groups, more complex
4. **Copy certs into image**: Bakes secrets into image layers

The `podman unshare` approach is the cleanest and most secure solution for rootless containers.
