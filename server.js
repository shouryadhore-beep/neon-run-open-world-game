import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const maxRoomSize = 8;
const rooms = new Map();

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message, except) {
  for (const player of room.values()) {
    if (player.socket !== except) send(player.socket, message);
  }
}

function removeFromRoom(socket) {
  const { roomCode, player } = socket;
  if (!roomCode || !player) return;
  const room = rooms.get(roomCode);
  if (!room) return;
  room.delete(player.id);
  broadcast(room, { type: "player_left", id: player.id });
  if (room.size === 0) rooms.delete(roomCode);
  socket.roomCode = null;
  socket.player = null;
}

function isFiniteInRange(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function handleMessage(socket, rawMessage) {
  const now = Date.now();
  if (now - socket.messageWindowStartedAt >= 1000) {
    socket.messageWindowStartedAt = now;
    socket.messageCount = 0;
  }
  socket.messageCount += 1;
  if (socket.messageCount > 40) {
    socket.close(1008, "Message rate exceeded.");
    return;
  }

  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    send(socket, { type: "error", message: "Invalid message format." });
    return;
  }

  if (!message || typeof message !== "object" || Array.isArray(message)) {
    send(socket, { type: "error", message: "Invalid message format." });
    return;
  }

  if (message.type === "join") {
    if (socket.player) {
      send(socket, { type: "error", message: "You are already in a room." });
      return;
    }
    if (typeof message.room !== "string" || !/^[A-Z0-9]{4,8}$/.test(message.room)) {
      send(socket, { type: "error", message: "Room codes must contain 4–8 letters or numbers." });
      return;
    }
    const roomCode = message.room;
    let room = rooms.get(roomCode);
    if (room && room.size >= maxRoomSize) {
      send(socket, { type: "error", message: "That room is full (maximum 8 players)." });
      return;
    }
    if (!room) {
      room = new Map();
      rooms.set(roomCode, room);
    }

    const name = typeof message.name === "string"
      ? message.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 18) || "DRIVER"
      : "DRIVER";
    const player = {
      id: randomUUID(),
      name,
      color: Number.isInteger(message.color) && message.color >= 0 && message.color <= 5
        ? message.color
        : Math.floor(Math.random() * 6),
      state: null
    };
    socket.player = player;
    socket.roomCode = roomCode;
    room.set(player.id, { ...player, socket });
    send(socket, {
      type: "welcome",
      id: player.id,
      room: roomCode,
      players: [...room.values()]
        .filter(other => other.id !== player.id)
        .map(({ socket: _socket, ...other }) => other)
    });
    broadcast(room, { type: "player_joined", player }, socket);
    return;
  }

  if (message.type !== "state" || !socket.player) {
    send(socket, { type: "error", message: "Join a room before sending game updates." });
    return;
  }

  if (!message.state || typeof message.state !== "object"
    || !isFiniteInRange(message.state.x, -10_000_000, 10_000_000)
    || !isFiniteInRange(message.state.y, -10_000, 10_000)
    || !isFiniteInRange(message.state.z, -10_000_000, 10_000_000)
    || !isFiniteInRange(message.state.heading, -100_000, 100_000)
    || !isFiniteInRange(message.state.speed, -100, 150)
    || !Number.isInteger(message.state.color)
    || message.state.color < 0 || message.state.color > 5) {
    send(socket, { type: "error", message: "Invalid player state." });
    return;
  }

  const player = socket.player;
  player.state = {
    x: message.state.x,
    y: message.state.y,
    z: message.state.z,
    heading: message.state.heading,
    speed: message.state.speed
  };
  player.color = message.state.color;
  const room = rooms.get(socket.roomCode);
  const roomPlayer = room?.get(player.id);
  if (roomPlayer) {
    roomPlayer.state = player.state;
    roomPlayer.color = player.color;
    broadcast(room, { type: "state", player }, socket);
  }
}

const httpServer = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
  if (pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }

  if (pathname !== "/" && pathname !== "/index.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }

  try {
    const html = await readFile(new URL("./index.html", import.meta.url));
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : html);
  } catch (error) {
    console.error("Could not read index.html:", error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Could not load the game.");
  }
});

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });

httpServer.on("upgrade", (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;
  let validOrigin = true;
  if (origin) {
    try {
      validOrigin = new URL(origin).host === request.headers.host;
    } catch {
      validOrigin = false;
    }
  }
  if (pathname !== "/multiplayer" || !validOrigin) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, client => {
    webSocketServer.emit("connection", client, request);
  });
});

webSocketServer.on("connection", socket => {
  socket.messageWindowStartedAt = Date.now();
  socket.messageCount = 0;
  socket.on("message", rawMessage => handleMessage(socket, rawMessage));
  socket.on("close", () => removeFromRoom(socket));
  socket.on("error", error => console.error("Multiplayer socket error:", error.message));
});

httpServer.listen(port, host, () => {
  console.log(`NEON RUN server listening on http://${host}:${port}`);
  console.log("Players can join one another with a shared room code.");
});

httpServer.on("error", error => {
  console.error("Could not start the game server:", error);
  process.exitCode = 1;
});
