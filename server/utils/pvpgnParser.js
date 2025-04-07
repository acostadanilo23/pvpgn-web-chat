// server/utils/pvpgnParser.js

/**
 * Mapeamento de códigos de mensagem PvPGN para tipos legíveis.
 * Baseado nos códigos do cliente Rust original.
 * NOTA: PvPGN pode ter variações, ajuste conforme necessário.
 */
const MESSAGE_CODES = {
    '1001': 'USER', // Usuário na lista inicial do canal
    '1002': 'JOIN', // Usuário entrou no canal
    '1003': 'LEAVE', // Usuário saiu do canal
    '1004': 'WHISPER', // Sussurro recebido
    '1005': 'TALK', // Mensagem pública no canal
    '1007': 'CHANNEL', // Informação sobre o canal atual (limpa lista de usuários)
    '1009': 'USER', // Outro código para usuário na lista? (Confirmar com PvPGN)
    '1010': 'WHISPER_TO', // Confirmação de sussurro enviado
    '1018': 'INFO', // Mensagem informativa do servidor
    '1019': 'ERROR', // Mensagem de erro do servidor
    '1020': 'STATS', // Informações de estatísticas (pode precisar de parsing extra)
    '1022': 'LOGGED_IN', // Indicação de login bem-sucedido (pode não ser um código numérico direto)
    '1023': 'LOGGED_OUT', // Indicação de logout (pode não ser um código numérico direto)
    // Adicione outros códigos conforme necessário (ex: BROADCAST, etc.)
  };
  
  /**
   * Analisa uma única linha de mensagem recebida do servidor PvPGN.
   *
   * @param {string} line - A linha de texto crua do servidor PvPGN.
   * @returns {object | null} Um objeto representando a mensagem analisada
   *                          (ex: { type: 'TALK', user: 'Player1', message: 'Hello' })
   *                          ou null se a linha for inválida ou não puder ser analisada.
   */
  function parseLine(line) {
    if (!line || typeof line !== 'string') {
      return null;
    }
  
    const parts = line.trim().split(' ');
    if (parts.length < 1) {
      return null;
    }
  
    const code = parts[0];
    const messageType = MESSAGE_CODES[code] || 'UNKNOWN';
  
    // Remove o código e o tipo textual (se existir, como em "1005 TALK")
    parts.shift(); // Remove o código
    if (parts.length > 0 && parts[0].toUpperCase() === messageType) {
      parts.shift(); // Remove o tipo textual se corresponder
    }
  
    try {
      switch (messageType) {
        case 'USER': // 1001 ou 1009
        case 'JOIN': // 1002
          // Formato: <CODE> <TYPE> <Username> <Flags> <Ping?> <...>
          if (parts.length >= 1) {
            return { type: messageType, user: parts[0] };
          }
          break;
        case 'LEAVE': // 1003
          // Formato: <CODE> <TYPE> <Username>
          if (parts.length >= 1) {
            return { type: messageType, user: parts[0] };
          }
          break;
        case 'WHISPER': // 1004
          // Formato: <CODE> <TYPE> <FromUser> <Flags?> <Message...>
          if (parts.length >= 2) {
            // O segundo elemento pode ser flags, vamos assumir que é parte da mensagem por simplicidade
            const user = parts[0];
            const message = parts.slice(1).join(' ');
            return { type: messageType, user, message };
          }
          break;
        case 'TALK': // 1005
          // Formato: <CODE> <TYPE> <Username> <Flags?> <Message...>
          if (parts.length >= 2) {
            // O segundo elemento pode ser flags, vamos assumir que é parte da mensagem por simplicidade
            const user = parts[0];
            const message = parts.slice(1).join(' ');
            return { type: messageType, user, message };
          }
          break;
        case 'WHISPER_TO': // 1010
          // Formato: <CODE> <TYPE> <ToUser> <Flags?> <Message...>
          if (parts.length >= 2) {
            const user = parts[0]; // Usuário para quem você sussurrou
            const message = parts.slice(1).join(' ');
            return { type: messageType, user, message };
          }
          break;
        case 'INFO': // 1018
        case 'ERROR': // 1019
        case 'STATS': // 1020
          // Formato: <CODE> <TYPE> <Message...>
          return { type: messageType, message: parts.join(' ') };
  
        case 'CHANNEL': // 1007
          // Formato: <CODE> <TYPE> <ChannelName>
          // Indica entrada em um novo canal, geralmente limpa a lista de usuários.
          return { type: messageType, channel: parts.join(' ') };
  
        // Casos como LOGGED_IN, LOGGED_OUT podem não vir com códigos numéricos
        // e precisarão ser tratados no PvpgnClient com base em texto específico.
  
        case 'UNKNOWN':
        default:
          // Retorna a linha original para depuração ou tratamento genérico
          return { type: 'RAW', message: line };
      }
    } catch (error) {
      console.error(`[PvPGN Parser] Error parsing line: "${line}"`, error);
      return { type: 'PARSE_ERROR', message: line }; // Informa sobre o erro
    }
  
    // Se chegou aqui, o formato não correspondeu aos casos esperados
    console.warn(`[PvPGN Parser] Unhandled format for type ${messageType}: "${line}"`);
    return { type: 'UNHANDLED', messageType, originalLine: line };
  }
  
  module.exports = { parseLine };
  