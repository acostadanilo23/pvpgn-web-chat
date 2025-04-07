// server/modules/WebSocketServer.js

const WebSocket = require('ws');
const { PvpgnClient, ConnectionState } = require('./PvpgnClient');

/**
 * Gerencia o servidor WebSocket e a comunicação com os clientes (navegadores).
 * Cria e gerencia instâncias individuais de PvpgnClient.
 */
class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer });
    this.clientConnections = new Map();
    this._setupWebSocketServer();
    console.log('[WebSocket Server] Initialized. Ready for client connections.');
  }

  _setupWebSocketServer() {
    this.wss.on('connection', (ws) => {
      console.log('[WebSocket Server] Client WebSocket connected.');
      this.sendTo(ws, { type: 'status', payload: { state: ConnectionState.DISCONNECTED, message: 'Please login' } });

      ws.on('message', (message) => {
        this._handleClientMessage(ws, message);
      });
      ws.on('close', () => {
        console.log('[WebSocket Server] Client WebSocket disconnected.');
        this._cleanupClientConnection(ws);
      });
      ws.on('error', (error) => {
        console.error('[WebSocket Server] Client WebSocket error:', error);
        this._cleanupClientConnection(ws);
      });
    });
    this.wss.on('error', (error) => {
        console.error('[WebSocket Server] Server error:', error);
    });
  }

  _handleClientMessage(ws, message) {
    try {
      const parsedMessage = JSON.parse(message.toString());
      // *** Log de Debug Backend ***
      console.log('[WebSocket Server] Received message from client:', parsedMessage);
      // ****************************

      switch (parsedMessage.type) {
        case 'login':
          if (parsedMessage.payload &&
              parsedMessage.payload.host &&
              parsedMessage.payload.port &&
              parsedMessage.payload.username &&
              parsedMessage.payload.password)
          {
            console.log(`[WebSocket Server] Handling "login" for user: ${parsedMessage.payload.username} to ${parsedMessage.payload.host}:${parsedMessage.payload.port}`);
            this._initiatePvpgnConnection(ws, parsedMessage.payload);
          } else {
            this.sendTo(ws, { type: 'error', payload: { source: 'client', message: 'Invalid login payload. Missing fields.' } });
          }
          break;

        case 'chat':
          // *** Log de Debug Backend ***
          console.log('[WebSocket Server] Handling "chat" message.');
          // ****************************
          const connectionData = this.clientConnections.get(ws);
          const clientState = connectionData ? connectionData.pvpgnClient.getState() : 'N/A';
          // *** Log de Debug Backend ***
          console.log(`[WebSocket Server] Checking PvPGN state for chat: ${clientState}`);
          // ****************************

          if (connectionData && connectionData.pvpgnClient && clientState === ConnectionState.CONNECTED)
          {
             // *** Log de Debug Backend ***
            console.log('[WebSocket Server] State is CONNECTED. Calling pvpgnClient.sendMessage...');
             // ****************************
            if (parsedMessage.payload && typeof parsedMessage.payload === 'string') {
              // Chama o método no PvpgnClient associado
              connectionData.pvpgnClient.sendMessage(parsedMessage.payload);
            } else {
              console.log('[WebSocket Server] Invalid chat payload.');
              this.sendTo(ws, { type: 'error', payload: { source: 'client', message: 'Invalid chat payload.' } });
            }
          } else {
             // *** Log de Debug Backend ***
            console.log('[WebSocket Server] State is NOT CONNECTED. Blocking chat message.');
             // ****************************
            this.sendTo(ws, { type: 'error', payload: { source: 'client', message: `Cannot send message, not fully connected (state: ${clientState}).` } });
          }
          break;

        case 'disconnect':
             console.log('[WebSocket Server] Handling "disconnect" request.');
             this._cleanupClientConnection(ws);
             break;

        default:
          console.warn(`[WebSocket Server] Received unknown message type from client: ${parsedMessage.type}`);
          this.sendTo(ws, { type: 'error', payload: { source: 'client', message: `Unknown command type: ${parsedMessage.type}` } });
      }
    } catch (error) {
      console.error('[WebSocket Server] Failed to parse client message or handle command:', error);
      this.sendTo(ws, { type: 'error', payload: { source: 'server', message: 'Invalid message format received.' } });
    }
  }

  _initiatePvpgnConnection(ws, credentials) {
    this._cleanupClientConnection(ws);
    const pvpgnClient = new PvpgnClient(credentials.host, credentials.port);
    const userList = new Set();
    this.clientConnections.set(ws, { pvpgnClient, userList });
    console.log(`[WebSocket Server] Stored new PvPGN client association for WebSocket.`);

    pvpgnClient.on('status', (state, message) => {
      this.sendTo(ws, { type: 'status', payload: { state, message } });
      if (state === ConnectionState.DISCONNECTED || state === ConnectionState.ERROR) {
        const connData = this.clientConnections.get(ws);
        if (connData) {
            connData.userList.clear();
            this._sendUserListUpdate(ws);
        }
      }
    });
    pvpgnClient.on('message', (parsedMessage) => {
      this._updateUserListForConnection(ws, parsedMessage);
      this.sendTo(ws, { type: 'message', payload: parsedMessage });
    });
    pvpgnClient.on('error', (error) => {
      this.sendTo(ws, { type: 'error', payload: { source: 'pvpgn', message: error.message } });
    });
    // pvpgnClient.on('raw_message', (line) => { /* Opcional */ });

    pvpgnClient.connect(credentials.username, credentials.password);
  }

  _cleanupClientConnection(ws) {
    const connectionData = this.clientConnections.get(ws);
    if (connectionData) {
      console.log(`[WebSocket Server] Cleaning up PvPGN connection for WebSocket.`);
      if (connectionData.pvpgnClient) {
        connectionData.pvpgnClient.disconnect();
        connectionData.pvpgnClient.removeAllListeners();
      }
      this.clientConnections.delete(ws);
      console.log(`[WebSocket Server] Removed PvPGN client association.`);
      if (ws.readyState === WebSocket.OPEN) {
           this.sendTo(ws, { type: 'status', payload: { state: ConnectionState.DISCONNECTED, message: 'Disconnected.' } });
           this._sendUserListUpdate(ws);
      }
    }
  }

  _updateUserListForConnection(ws, parsedMessage) {
    const connectionData = this.clientConnections.get(ws);
    if (!connectionData) return;
    const userList = connectionData.userList;
    let listChanged = false;
    switch (parsedMessage.type) {
      case 'CHANNEL': userList.clear(); listChanged = true; break;
      case 'USER': case 'JOIN': if (parsedMessage.user && userList.add(parsedMessage.user)) { listChanged = true; } break;
      case 'LEAVE': if (parsedMessage.user && userList.delete(parsedMessage.user)) { listChanged = true; } break;
    }
    if (listChanged) { this._sendUserListUpdate(ws); }
  }

  _sendUserListUpdate(ws) {
    const connectionData = this.clientConnections.get(ws);
    const users = connectionData ? Array.from(connectionData.userList) : [];
    this.sendTo(ws, { type: 'userlist', payload: users });
  }

  sendTo(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(message)); }
      catch (error) {
        console.error(`[WebSocket Server] Error sending message to specific client:`, error);
        this._cleanupClientConnection(ws);
      }
    }
  }

  shutdown() {
      console.log('[WebSocket Server] Shutting down... Disconnecting all active PvPGN clients.');
      this.clientConnections.forEach((connectionData, ws) => {
          console.log(`[WebSocket Server] Disconnecting client associated with WebSocket.`);
          this._cleanupClientConnection(ws);
          if (ws.readyState === WebSocket.OPEN) {
              ws.close(1001, 'Server shutting down');
          }
      });
      this.clientConnections.clear();
      console.log('[WebSocket Server] All client connections cleaned up.');
  }
}

module.exports = WebSocketServer; // Exporta a classe diretamente
