// server/server.js

const express = require('express');
const http = require('http');
const path = require('path');
// Removido: const { PvpgnClient } = require('./modules/PvpgnClient'); // Não mais necessário aqui
const WebSocketServer = require('./modules/WebSocketServer'); // Continua necessário

// --- Configuração ---
// Removido: PVPGN_HOST e PVPGN_PORT não são mais configurados globalmente aqui
const SERVER_PORT = parseInt(process.env.PORT || '3000', 10); // Porta para o servidor web/websocket

// --- Inicialização ---
const app = express();
const httpServer = http.createServer(app);

// --- Servir Arquivos Estáticos (Frontend) ---
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));
console.log(`[Server] Serving static files from: ${publicPath}`);

// Rota principal para servir o index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// --- Instanciar Módulos ---
// Removido: A instância compartilhada pvpgnClient não é mais criada aqui
// const pvpgnClient = new PvpgnClient(PVPGN_HOST, PVPGN_PORT);

// Cria o servidor WebSocket, passando apenas o servidor HTTP.
// O WebSocketServer agora gerenciará as instâncias PvpgnClient internamente.
const wsServer = new WebSocketServer(httpServer); // Não passa mais pvpgnClient

// --- Iniciar Servidor ---
httpServer.listen(SERVER_PORT, () => {
  console.log(`[Server] HTTP and WebSocket server listening on port ${SERVER_PORT}`);
  // Removido log sobre conexão PvPGN pré-configurada
  console.log(`[Server] Ready to accept client connections.`);
  console.log(`[Server] Access the client at http://localhost:${SERVER_PORT}`);
});

// --- Tratamento de Encerramento ---
process.on('SIGINT', () => {
  console.log('\n[Server] SIGINT received. Shutting down gracefully...');
  // 1. Desconectar todos os clientes PvPGN ativos (o WebSocketServer fará isso)
  wsServer.shutdown(); // Adicionar um método shutdown no WebSocketServer

  // 2. Fechar o servidor WebSocket (notifica clientes)
  // O shutdown do wsServer pode já fechar isso, mas garantir aqui
  wsServer.wss.close(() => {
    console.log('[WebSocket Server] Closed.');
  });

  // 3. Fechar o servidor HTTP
  httpServer.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });

  // Força o encerramento após um tempo se algo travar
  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcing shut down.');
    process.exit(1);
  }, 5000);
});
