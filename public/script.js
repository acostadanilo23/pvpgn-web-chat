// public/script.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos da UI ---
    const loginView = document.getElementById('login-view');
    const chatView = document.getElementById('chat-view');
    const loginForm = document.getElementById('login-form');
    const serverHostInput = document.getElementById('server-host');
    const serverPortInput = document.getElementById('server-port');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginError = document.getElementById('login-error');

    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const statusMessage = document.getElementById('status-message');

    const userList = document.getElementById('user-list');
    const messagesDiv = document.getElementById('messages');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const disconnectButton = document.getElementById('disconnect-button');

    // --- Variáveis de Estado ---
    let ws = null; // Instância do WebSocket
    let currentStatus = 'DISCONNECTED'; // Mantém o último estado conhecido

    // --- Funções Auxiliares ---

    /**
     * Atualiza o indicador de status na UI.
     * @param {string} state - O estado da conexão (ex: 'CONNECTED', 'DISCONNECTED').
     * @param {string} [message] - Mensagem adicional de status.
     */
    function updateStatusUI(state, message = '') {
        currentStatus = state; // Atualiza o estado global
        statusText.textContent = state.replace(/_/g, ' ');
        statusIndicator.className = `status status-${state.toLowerCase()}`;
        statusMessage.textContent = message || '';
        loginError.textContent = ''; // Limpa erros de login ao mudar status

        // Mostra/Esconde views com base no status
        if (state === 'CONNECTED') {
            loginView.classList.add('hidden');
            chatView.classList.remove('hidden');
            messageInput.focus(); // Foca no input de mensagem
        } else {
            loginView.classList.remove('hidden');
            chatView.classList.add('hidden');
            // Limpa lista de usuários e mensagens ao desconectar ou dar erro
            if (state === 'DISCONNECTED' || state === 'ERROR') {
                 updateUserListUI([]); // Limpa lista de usuários na UI
                 messagesDiv.innerHTML = ''; // Limpa mensagens na UI
            }
        }

        // Exibe erro específico no login se o status for ERROR
        if (state === 'ERROR' && !chatView.classList.contains('hidden')) {
            // Se já estava no chat e deu erro, mostra no status principal
        } else if (state === 'ERROR') {
            loginError.textContent = `Error: ${message || 'Connection failed'}`;
        }
    }

    /**
     * Adiciona uma mensagem formatada à área de chat.
     * @param {object} msgData - O objeto da mensagem recebido do servidor ou criado localmente.
     */
    function addChatMessage(msgData) {
        const messageElement = document.createElement('div');
        // Adiciona fallback para tipo desconhecido
        const messageType = msgData.type || 'UNKNOWN';
        messageElement.classList.add('message', `type-${messageType}`);

        let contentHTML = '';
        switch (messageType) {
            case 'TALK':
                contentHTML = `<span class="user">${escapeHtml(msgData.user)}:</span> <span class="content">${escapeHtml(msgData.message)}</span>`;
                break;
            case 'WHISPER':
                contentHTML = `<span class="user">[Whisper from ${escapeHtml(msgData.user)}]:</span> <span class="content">${escapeHtml(msgData.message)}</span>`;
                break;
            case 'WHISPER_TO':
                 contentHTML = `<span class="user">[Whisper to ${escapeHtml(msgData.user)}]:</span> <span class="content">${escapeHtml(msgData.message)}</span>`;
                break;
            case 'JOIN':
                contentHTML = `<span class="content">User ${escapeHtml(msgData.user)} has joined the channel.</span>`;
                break;
            case 'LEAVE':
                contentHTML = `<span class="content">User ${escapeHtml(msgData.user)} has left the channel.</span>`;
                break;
            // *** CORRIGIDO: Não exibir mensagens USER no chat ***
            case 'USER':
                // Mensagens USER apenas atualizam a lista de usuários, não são mostradas no chat.
                return; // Simplesmente não adiciona o elemento ao DOM
            // ***************************************************
            case 'INFO':
            case 'ERROR':
            case 'STATS':
            case 'CHANNEL':
                // Garante que o conteúdo seja escapado
                const infoMsg = escapeHtml(msgData.message || msgData.channel || '');
                contentHTML = `<span class="content">[${messageType}] ${infoMsg}</span>`;
                break;
             case 'RAW':
             case 'UNHANDLED':
             case 'PARSE_ERROR':
                 const codePrefix = msgData.code ? `(${escapeHtml(msgData.code)}) ` : '';
                 const rawMsg = escapeHtml(msgData.message || msgData.originalLine || '');
                 contentHTML = `<span class="content">[${messageType}] ${codePrefix}${rawMsg}</span>`;
                 break;
            // *** NOVO: Caso para exibir a mensagem enviada pelo próprio usuário ***
            case 'LOCAL_ECHO':
                 contentHTML = `<span class="user">You:</span> <span class="content">${escapeHtml(msgData.message)}</span>`;
                 // Adiciona uma classe extra para possível estilização diferente
                 messageElement.classList.add('type-LOCAL-ECHO');
                 // Exemplo de estilo inline (melhor fazer via CSS):
                 // messageElement.style.backgroundColor = '#e1f5fe'; // Light blue background
                 break;
            // ******************************************************************
            default:
                console.warn('Unknown message type for display:', messageType, msgData);
                contentHTML = `<span class="content">[${messageType || 'UNKNOWN'}] ${escapeHtml(JSON.stringify(msgData.payload || msgData))}</span>`;
        }

        messageElement.innerHTML = contentHTML;
        messagesDiv.appendChild(messageElement);

        // Auto-scroll para a última mensagem
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    /**
     * Atualiza a lista de usuários na UI.
     * @param {string[]} users - Array com os nomes dos usuários.
     */
    function updateUserListUI(users) {
        userList.innerHTML = ''; // Limpa a lista atual
        users.sort((a, b) => a.localeCompare(b)); // Ordena alfabeticamente
        users.forEach(user => {
            const li = document.createElement('li');
            // Escapa o nome do usuário antes de definir como textContent
            li.textContent = user; // textContent já escapa HTML, mas boa prática ser consistente
            userList.appendChild(li);
        });
    }

    /**
     * Escapa caracteres HTML para prevenir XSS.
     * @param {string} unsafe - A string potencialmente insegura.
     * @returns {string} A string segura.
     */
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') {
            // Tenta converter para string, se não for, retorna string vazia
            try {
                unsafe = String(unsafe);
            } catch (e) {
                return '';
            }
        }
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    /**
     * Envia um objeto de mensagem para o servidor WebSocket.
     * @param {object} messageObject - O objeto a ser enviado (será JSON.stringify).
     */
    function sendWebSocketMessage(messageObject) {
        // console.log('[Frontend] Attempting to send WebSocket message:', messageObject); // Debug
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(messageObject));
                 // console.log('[Frontend] WebSocket message sent.'); // Debug
            } catch (error) {
                console.error("[Frontend] WebSocket send error:", error);
                updateStatusUI('ERROR', 'Failed to send message to server.');
            }
        } else {
            console.warn("[Frontend] WebSocket not open. Cannot send message:", messageObject.type, "ReadyState:", (ws ? ws.readyState : 'N/A'));
            updateStatusUI('ERROR', 'Connection is not open.');
        }
    }


    // --- Lógica de Conexão WebSocket ---

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;

        console.log(`[Frontend] Attempting to connect WebSocket to: ${wsUrl}`);

        if (ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close();
        }

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[Frontend] WebSocket connection established.');
            updateStatusUI('DISCONNECTED', 'WebSocket connected. Please login.');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // console.log('[Frontend] WebSocket message received:', data); // Debug

                switch (data.type) {
                    case 'status':
                        updateStatusUI(data.payload.state, data.payload.message);
                        break;
                    case 'message':
                        addChatMessage(data.payload);
                        break;
                    case 'userlist':
                        updateUserListUI(data.payload);
                        break;
                    case 'error':
                        console.error(`[Frontend] Server Error (${data.payload.source}):`, data.payload.message);
                        if (data.payload.source === 'pvpgn' || data.payload.source === 'server') {
                             if (currentStatus !== 'CONNECTED') {
                                updateStatusUI('ERROR', data.payload.message);
                             } else {
                                addChatMessage({ type: 'ERROR', message: `Server Error: ${data.payload.message}` });
                             }
                        } else if (data.payload.source === 'client') {
                            loginError.textContent = data.payload.message;
                        }
                        break;
                    case 'raw_message':
                        // console.log('RAW:', data.payload); // Debug
                        break;
                    default:
                        console.warn('[Frontend] Unknown WebSocket message type:', data.type);
                }
            } catch (error) {
                console.error('[Frontend] Failed to parse WebSocket message:', error, event.data);
            }
        };

        ws.onerror = (error) => {
            console.error('[Frontend] WebSocket error:', error);
            updateStatusUI('ERROR', 'WebSocket connection error.');
        };

        ws.onclose = (event) => {
            console.log('[Frontend] WebSocket connection closed.', event.code, event.reason);
            ws = null;
             if (!['DISCONNECTED', 'ERROR'].includes(currentStatus)) {
                 updateStatusUI('DISCONNECTED', 'Connection closed.');
            }
        };
    }

    // --- Event Listeners da UI ---

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const host = serverHostInput.value.trim();
        const port = parseInt(serverPortInput.value, 10);
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!host) { loginError.textContent = 'Server Host/IP is required.'; return; }
        if (isNaN(port) || port < 1 || port > 65535) { loginError.textContent = 'Invalid Server Port number.'; return; }
        if (!username || !password) { loginError.textContent = 'Username and password are required.'; return; }

        loginError.textContent = '';
        updateStatusUI('CONNECTING', `Connecting to ${host}:${port}...`);
        sendWebSocketMessage({
            type: 'login',
            payload: { host, port, username, password }
        });
    });

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();

        // console.log('[Frontend] Submit event fired. Message:', message); // Debug
        // console.log('[Frontend] Checking conditions: ws?', !!ws, 'readyState?', (ws ? ws.readyState : 'N/A'), 'status?', currentStatus); // Debug

        if (message && ws && ws.readyState === WebSocket.OPEN && currentStatus === 'CONNECTED') {
            // console.log('[Frontend] Conditions MET. Calling sendWebSocketMessage for chat.'); // Debug
            sendWebSocketMessage({ type: 'chat', payload: message });

            // *** WORKAROUND: Adiciona a mensagem localmente à UI imediatamente ***
            addChatMessage({ type: 'LOCAL_ECHO', message: message });
            // *******************************************************************

            messageInput.value = ''; // Limpa o input
        } else {
            // console.log('[Frontend] Conditions NOT MET for sending chat.'); // Debug
             if (currentStatus !== 'CONNECTED') {
                 addChatMessage({ type: 'ERROR', message: 'You are not connected to the chat server.' });
             } else if (!ws || ws.readyState !== WebSocket.OPEN) {
                  addChatMessage({ type: 'ERROR', message: 'WebSocket connection is not open.' });
             }
        }
    });

    disconnectButton.addEventListener('click', () => {
        console.log('[Frontend] Disconnect button clicked.');
        sendWebSocketMessage({ type: 'disconnect' });
    });

    // --- Inicialização ---
    updateStatusUI('DISCONNECTED');
    connectWebSocket();

});
