# Nova — full-stack social app

Nova keeps the existing polished UI and now uses a real server-backed data layer.

## What is live in this build
- Real email/password accounts with bcrypt password hashing
- Persistent SQLite database
- Persistent server-side sessions
- Profiles: name, handle, bio, tags, accent, avatar, banner
- Real friend requests with accept/decline and reciprocal friendships
- Real direct-message conversations and message history
- Real group membership
- Realtime WebSocket message delivery and online presence
- Responsive Nova UI from the previous prototype
- Deployment files for Render and Docker

## Run locally

```bash
cd backend
npm ci
npm start
```

Then open `http://localhost:3000`.

Demo accounts all use password `nova123`:
- `edwin@nova.local`
- `mika@nova.local`
- `jay@nova.local`
- `kai@nova.local`
- `luna@nova.local`

## Put Nova on the public web

### Render (recommended for this SQLite build)
1. Create a GitHub repository and upload this project.
2. In Render, create a **Blueprint** from the repository.
3. Render will read `render.yaml`, install the backend, create a persistent 1 GB disk, and deploy Nova. The persistent-disk setup requires a paid web-service compute plan; Render documents that persistent disks are attached to paid services.
4. Open the generated `onrender.com` URL.

The persistent disk is important because Nova stores the SQLite database and sessions there. Render’s filesystem is otherwise ephemeral, so a free/ephemeral deployment is suitable only for a temporary demo, not for keeping user data.

### Docker

```bash
docker build -t nova-social .
docker run -p 3000:3000 -e SESSION_SECRET="replace-this" -v nova-data:/app/backend/data nova-social
```

## Important production notes
- Change the generated/session secret if you deploy somewhere else.
- Use HTTPS in production; the app automatically marks the session cookie secure when `NODE_ENV=production`.
- The current app is a strong production-ready foundation, but larger scale should eventually move from SQLite to Postgres and object storage for profile media.
- Rate limiting, email verification, password reset, moderation/reporting, and a managed object store are the next hardening steps before a large public launch.
