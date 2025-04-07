// server/modules/PvpgnClient.js

const net = require('net');
const EventEmitter = require('events');
const { parseLine } = require('../utils/pvpgnParser');

/**
 * Representa o estado da conexão com o servidor PvPGN.
 * @readonly
 * @enum {string}
 */
const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  AUTHENTICATING: 'AUTHENTICATING',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR',
};

// Intervalo para enviar keep-alives (em milissegundos)
const KEEP_ALIVE_INTERVAL = 60000; // 60 segundos

/**
 * Gerencia a conexão TCP e a comunicação com um servidor PvPGN.
 * Emite eventos para o WebSocketServer.
 */
class PvpgnClient extends EventEmitter {
  constructor(host, port) {
    super();
    this.host = host;
    this.port = port;
    this.socket = null;
    this.state = ConnectionState.DISCONNECTED;
    this.buffer = '';
    this.username = null;
    this.password = null;
    this.loginTimeout = null;
    this.currentChannel = null;
    this.usernameSent = false;
    // *** NOVO: Referência para o timer do keep-alive ***
    this.keepAliveIntervalId = null;
    // **************************************************
    this._updateStatus(ConnectionState.DISCONNECTED);
  }

  /**
   * Limpa todos os timers ativos (login e keep-alive).
   * @private
   */
  _clearTimers() {
      if (this.loginTimeout) {
          clearTimeout(this.loginTimeout);
          this.loginTimeout = null;
      }
      if (this.keepAliveIntervalId) {
          clearInterval(this.keepAliveIntervalId);
          this.keepAliveIntervalId = null;
          console.log('[PvPGN Client] Keep-alive interval stopped.');
      }
  }

  /**
   * Inicia o timer de keep-alive.
   * @private
   */
  _startKeepAlive() {
      // Limpa qualquer timer anterior (segurança)
      this._stopKeepAlive();
      console.log(`[PvPGN Client] Starting keep-alive interval (${KEEP_ALIVE_INTERVAL}ms).`);
      this.keepAliveIntervalId = setInterval(() => {
          this._sendKeepAlive();
      }, KEEP_ALIVE_INTERVAL);
  }

  /**
   * Para o timer de keep-alive.
   * @private
   */
  _stopKeepAlive() {
       if (this.keepAliveIntervalId) {
          clearInterval(this.keepAliveIntervalId);
          this.keepAliveIntervalId = null;
          console.log('[PvPGN Client] Keep-alive interval stopped.');
      }
  }

  /**
   * Envia um pacote keep-alive para o servidor.
   * @private
   */
  _sendKeepAlive() {
      // Verifica se ainda estamos conectados antes de enviar
      if (this.state === ConnectionState.CONNECTED && this.socket && !this.socket.destroyed) {
          console.log('[PvPGN Client] Sending keep-alive (/nop)');
          // Usamos write diretamente para não poluir logs de sendMessage e evitar checagens extras
          try {
              this.socket.write('/nop\r\n');
          } catch (error) {
               console.error('[PvPGN Client] Error sending keep-alive:', error);
               this._handleError(error); // Trata erro de envio
          }
      } else {
          console.warn('[PvPGN Client] Skipping keep-alive send, not connected.');
          // Se não estamos conectados, o timer já deveria ter sido parado, mas paramos de novo por segurança.
          this._stopKeepAlive();
      }
  }


  _updateStatus(newState, message) {
    if (this.state !== newState) {
      const oldState = this.state;
      console.log(`[PvPGN Client] Status: ${oldState} -> ${newState}${message ? ` (${message})` : ''}`);
      this.state = newState;
      this.emit('status', this.state, message);

      // *** Gerenciamento do Keep-Alive baseado no estado ***
      if (newState === ConnectionState.CONNECTED) {
          // Inicia o keep-alive quando conectado
          this._startKeepAlive();
      } else if (oldState === ConnectionState.CONNECTED && newState !== ConnectionState.CONNECTED) {
          // Para o keep-alive se não estiver mais conectado
          this._stopKeepAlive();
      }
      // ****************************************************
    }
  }

  connect(username, password) {
    if (this.state !== ConnectionState.DISCONNECTED && this.state !== ConnectionState.ERROR) {
      console.warn('[PvPGN Client] Attempting to connect while already connected/connecting.');
      this.emit('error', new Error('Already connected or connecting.'));
      this._updateStatus(ConnectionState.ERROR, 'Already connected or connecting.');
      return;
    }
    if (!username || !password) {
        const errorMsg = 'Username and password are required.';
        this._updateStatus(ConnectionState.ERROR, errorMsg);
        this.emit('error', new Error(errorMsg));
        return;
    }
    this.username = username;
    this.password = password;
    this.buffer = '';
    this.usernameSent = false;
    this._updateStatus(ConnectionState.CONNECTING);
    console.log(`[PvPGN Client] Connecting to ${this.host}:${this.port}...`);
    this.socket = new net.Socket();
    this.socket.on('connect', this._handleConnect.bind(this));
    this.socket.on('data', this._handleData.bind(this));
    this.socket.on('close', this._handleClose.bind(this));
    this.socket.on('error', this._handleError.bind(this));
    this.socket.on('timeout', this._handleTimeout.bind(this));
    // *** Aumenta o timeout geral do socket para 5 minutos ***
    this.socket.setTimeout(300000); // 300 segundos = 5 minutos
    // ******************************************************
    this.socket.connect(this.port, this.host);
  }

  _handleConnect() {
    console.log('[PvPGN Client] TCP Connection established.');
    this._updateStatus(ConnectionState.AUTHENTICATING);
    this.socket.write(Buffer.from([0x03]));
    console.log('[PvPGN Client] Sent protocol initiation byte (0x03).');
    // Limpa timer de login anterior e inicia um novo
    if (this.loginTimeout) clearTimeout(this.loginTimeout);
    this.loginTimeout = setTimeout(() => {
        if (this.state === ConnectionState.AUTHENTICATING) {
            console.error('[PvPGN Client] Login timed out (did not receive expected prompts).');
            this._handleError(new Error('Login timed out - No response from server'));
        }
    }, 20000); // Mantém timeout de login curto (20s)
  }

  _handleData(data) {
    this.buffer += data.toString('utf8');
    // console.log('[PvPGN Client] --- Handling Data ---');
    // console.log('[PvPGN Client] Current buffer content:', JSON.stringify(this.buffer));

    let newlineIndex;
    let loopCount = 0;

    while ((newlineIndex = this.buffer.indexOf('\r\n')) !== -1) {
        loopCount++;
        const line = this.buffer.substring(0, newlineIndex);
        this.buffer = this.buffer.substring(newlineIndex + 2);

        // console.log(`[PvPGN Client] Loop ${loopCount}: Extracted complete line: ${JSON.stringify(line)}`);
        // console.log(`[PvPGN Client] Loop ${loopCount}: Remaining buffer: ${JSON.stringify(this.buffer)}`);

        this.emit('raw_message', line);
        this._processLine(line);

        if (loopCount > 100) {
            console.error("[PvPGN Client] Excessive loop count in _handleData, breaking loop.");
            this.buffer = '';
            this._handleError(new Error("Internal error: Data handling loop limit exceeded."));
            return;
        }
    }

    // Verifica o buffer restante para prompts de autenticação
    if (this.state === ConnectionState.AUTHENTICATING && this.buffer.length > 0) {
        // console.log(`[PvPGN Client] Checking remaining buffer during AUTH: ${JSON.stringify(this.buffer)}`);
        if (!this.usernameSent && this.buffer.includes('Username:')) {
            console.log('[PvPGN Client] --> "Username:" found in remaining buffer!');
            this._processLine(this.buffer);
        }
        else if (this.usernameSent && this.buffer.includes('Password:')) {
            console.log('[PvPGN Client] --> "Password:" found in remaining buffer!');
            this._processLine(this.buffer);
        }
        else if (this.buffer.includes('Login failed')) {
             console.log('[PvPGN Client] --> "Login failed" found in remaining buffer!');
             this._processLine(this.buffer);
        }
    }

    // console.log('[PvPGN Client] --- Finished Handling Data ---');
    // console.log('[PvPGN Client] Final buffer content (incomplete line):', JSON.stringify(this.buffer));
  }

  _processLine(lineOrBuffer) {
    const originalInput = lineOrBuffer;
    const trimmedInput = originalInput.trim();

    if (trimmedInput.length === 0) { return; }

    if (this.state === ConnectionState.AUTHENTICATING) {
      // console.log(`[PvPGN Client] AUTH state processing input (original: ${JSON.stringify(originalInput)}, trimmed: ${JSON.stringify(trimmedInput)})`);

      if (trimmedInput.includes('Username:')) {
        if (this.usernameSent) {
            console.warn('[PvPGN Client] Ignored repeated Username prompt during AUTH.');
            return;
        }
        // console.log('[PvPGN Client] --> Condition includes("Username:") MET!');
        console.log('[PvPGN Client] Received Username prompt. Sending username...');
        try {
            this.socket.write(`${this.username}\r\n`);
            console.log('[PvPGN Client] Username sent successfully.');
            this.usernameSent = true;
            const promptIndexInBuffer = this.buffer.indexOf('Username:');
            if (promptIndexInBuffer !== -1) { this.buffer = this.buffer.substring(promptIndexInBuffer + 'Username:'.length); }
        } catch (e) { this._handleError(e); }
        return;
      }

      if (trimmedInput.includes('Password:')) {
         if (!this.usernameSent) {
             console.error('[PvPGN Client] Received Password prompt before sending username.');
             this._handleError(new Error('Received Password prompt unexpectedly.'));
             return;
         }
        // console.log('[PvPGN Client] --> Condition includes("Password:") MET!');
        console.log('[PvPGN Client] Received Password prompt. Sending password...');
        try {
            this.socket.write(`${this.password}\r\n`);
            console.log('[PvPGN Client] Password sent successfully.');
            const joinCommand = "/join Tah'kaka chat";
            console.log(`[PvPGN Client] Sending join command: ${joinCommand}`);
            this.socket.write(`${joinCommand}\r\n`);
            console.log('[PvPGN Client] Join command sent successfully.');
            // Limpa o timeout de LOGIN aqui, pois a autenticação interativa terminou
            if (this.loginTimeout) { clearTimeout(this.loginTimeout); this.loginTimeout = null; }
            const promptIndexInBuffer = this.buffer.indexOf('Password:');
            if (promptIndexInBuffer !== -1) { this.buffer = this.buffer.substring(promptIndexInBuffer + 'Password:'.length); }
            // Muda o estado para CONNECTED, o que iniciará o keep-alive via _updateStatus
            this._updateStatus(ConnectionState.CONNECTED, 'Credentials and join command sent');
        } catch (e) { this._handleError(e); }
        return;
      }

      if (trimmedInput.includes('Login failed')) {
          console.error('[PvPGN Client] Server explicitly reported: Login failed during AUTH.');
          const msgIndexInBuffer = this.buffer.indexOf('Login failed');
          if (msgIndexInBuffer !== -1) {
                const endOfMsg = this.buffer.indexOf('\r\n', msgIndexInBuffer);
                this.buffer = (endOfMsg !== -1) ? this.buffer.substring(endOfMsg + 2) : this.buffer.substring(msgIndexInBuffer + 'Login failed'.length);
           }
          this._handleError(new Error('Login failed (reported by server). Check credentials.'));
          return;
      }

      // console.log(`[PvPGN Client] Received unhandled line during AUTH: "${trimmedInput}"`);
      const parsedAuthMsg = parseLine(originalInput);
       if (parsedAuthMsg && (parsedAuthMsg.type === 'ERROR' || parsedAuthMsg.type === 'INFO')) {
             // console.log(`[PvPGN Client] Forwarding Info/Error during AUTH: ${parsedAuthMsg.message}`);
             this.emit('message', parsedAuthMsg);
       }
       return;
    }

    // --- Processamento Geral (Estado CONNECTED) ---
    if (trimmedInput.includes('Username:') || trimmedInput.includes('Password:') || trimmedInput.includes('Login failed')) {
        console.warn(`[PvPGN Client] Ignored unexpected auth prompt/message in CONNECTED state: "${trimmedInput}"`);
        return;
    }

    const parsedMessage = parseLine(originalInput);
    if (parsedMessage) {
        if (parsedMessage.type === 'CHANNEL') {
            this.currentChannel = parsedMessage.channel;
            console.log(`[PvPGN Client] Confirmed/Updated channel: ${this.currentChannel}`);
        }
        this.emit('message', parsedMessage);
    } else {
        // console.warn(`[PvPGN Client] Parser returned null for line: ${JSON.stringify(originalInput)}`);
    }
  }

  _handleClose(hadError) {
    this._clearTimers(); // Garante que todos os timers sejam limpos
    if (this.state !== ConnectionState.DISCONNECTED) {
        const reason = hadError ? 'Connection closed due to error' : 'Connection closed';
        console.log(`[PvPGN Client] ${reason}`);
        this._updateStatus(this.state === ConnectionState.ERROR ? ConnectionState.ERROR : ConnectionState.DISCONNECTED, reason);
    }
    this.socket = null;
  }

  _handleError(err) {
    this._clearTimers(); // Garante que todos os timers sejam limpos
    if (this.state !== ConnectionState.ERROR) {
        console.error('[PvPGN Client] Connection Error:', err.message);
        this._updateStatus(ConnectionState.ERROR, err.message);
        this.emit('error', err);
    } else { console.error('[PvPGN Client] Additional Error Detail:', err.message); }
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }

   _handleTimeout() {
    console.error('[PvPGN Client] Socket timed out (inactivity).');
    // O timeout agora é de 5 minutos, mas ainda tratamos como erro.
    this._handleError(new Error(`Connection timed out (${this.socket.timeout / 1000}s inactivity)`));
  }

  sendMessage(message) {
    // console.log(`[PvPGN Client] sendMessage called. Current state: ${this.state}. Message: "${message}"`); // Debug
    if (this.state !== ConnectionState.CONNECTED) {
      console.warn(`[PvPGN Client] sendMessage blocked: Not in CONNECTED state (state: ${this.state}). Message: ${message}`);
      this.emit('error', new Error('Cannot send message, not fully connected.'));
      return;
    }
    if (!this.socket || this.socket.destroyed) {
        console.warn('[PvPGN Client] sendMessage blocked: Socket is closed/destroyed.');
        this.emit('error', new Error('Cannot send message, connection lost.'));
        return;
    }
    try {
        // console.log(`[PvPGN Client] Writing to socket: "${message}\\r\\n"`); // Debug
        this.socket.write(`${message}\r\n`);
        // console.log(`[PvPGN Client] Socket write successful.`); // Debug
    } catch (error) {
        console.error('[PvPGN Client] Error sending message via socket.write:', error);
        this._handleError(error);
    }
  }

  disconnect() {
    console.log(`[PvPGN Client] Disconnect requested. Current state: ${this.state}`);
    this._clearTimers(); // Garante que todos os timers sejam limpos
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
      console.log('[PvPGN Client] Socket closed and destroyed.');
    } else { console.log('[PvPGN Client] Socket already closed or null during disconnect request.'); }
    this._updateStatus(ConnectionState.DISCONNECTED, 'Manual disconnect');
  }

  getState() { return this.state; }
}

module.exports = { PvpgnClient, ConnectionState };
