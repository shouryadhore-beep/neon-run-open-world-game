# NEON RUN

An open-world driving game with roaming traffic and optional online multiplayer.

## Run the game

Install Node.js 20 or newer, then run these commands in this folder:

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The game server serves the page and carries multiplayer updates; opening `index.html` directly as a `file://` URL only supports single-player.

## Play online with friends

1. Host the server on a machine reachable by the other players, or deploy it to a Node.js host.
2. For internet play, serve the site over HTTPS and proxy WebSocket connections for `/multiplayer` to the Node server. The browser will then use secure WebSockets automatically.
3. Select **PLAYERS → CREATE A ROOM** and share the invite link or six-character room code.
4. Friends open the same hosted game and choose **PLAYERS → JOIN A ROOM**.

The server listens on `127.0.0.1:3000` by default. To accept connections on a LAN or from a hosting platform, set `HOST=0.0.0.0` and configure its port with `PORT`. Rooms support up to eight players. No account or external signaling service is needed.

## Deploy to Railway

The included `railway.json` configures Railway to build the Node.js app, run `npm start`, and check `/health`. To deploy, push this folder to a GitHub repository, then create a Railway project using **Deploy from GitHub repo** and select that repository. In the Railway service settings, enable a public domain. Railway supplies `PORT`; the server listens on all interfaces by default and accepts secure WebSocket room connections on the same domain.
