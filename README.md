# PvPGN Web Chat (Node.js)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A web-based chat client for connecting to classic Battle.net / PvPGN emulation servers using the text-based chat protocol (0x03).

![Screenshot Placeholder](placeholder.png)*

## Features

*   Connect to PvPGN servers via a web interface.
*   Basic chat functionality (send/receive public messages).
*   Real-time user list display for the current channel.
*   Secure communication between the browser and the Node.js backend (via HTTPS/WSS).
*   Modular Node.js backend architecture.
*   Configurable via environment variables.

## Motivation

This project was inspired by a similar client written in Rust and aims to provide a web-accessible alternative for chatting on PvPGN servers without needing a game client or native application.

## How It Works

This application consists of three main parts:

1.  **Frontend (Browser):** The user interface built with HTML, CSS, and vanilla JavaScript (`public/` directory). It communicates *exclusively* with the Node.js backend via a secure WebSocket (WSS). It does **not** connect directly to the PvPGN server.
2.  **Backend (Node.js Server):** This server acts as a secure gateway and protocol translator:
    *   Serves the frontend files to the user's browser via **HTTPS**.
    *   Manages secure WebSocket connections (**WSS**) from multiple browser clients.
    *   Receives simple commands (`login`, `chat`, `disconnect`) from the frontend via WSS.
    *   For each logged-in user, it establishes and manages a separate **plain TCP** connection to the specified PvPGN server (using the text protocol `0x03`).
    *   Handles the PvPGN authentication handshake (Username/Password prompts).
    *   Parses incoming messages from the PvPGN server (chat messages, user lists, info messages).
    *   Forwards relevant information (status updates, parsed messages, user lists) back to the correct browser client via WSS.
3.  **PvPGN Server (External):** The actual Battle.net emulation server (e.g., `pvpgn.tahkaka.xyz`) that the Node.js backend connects to via **plain TCP** on port 6112 (or as specified by the user).

+-----------------------+              +-------------------------+
|      User Clients     |              | External PvPGN Server   |
|                       |              |      (TCP Server)       |
| +-------------------+ |              +------------^------------+
| |    Web Browser    | |                           |
| +--------^----------+ |                           |
|          |            |                           | Connection 2
|          | (HTTPS/WSS)|                           | (TCP port 6112)
|          |            |                           | (Unencrypted)
| +--------v----------+ |<--------------------------+ (PvPGN Protocol 0x03)
| |    Native App     | |                           |
| | (iOS/Android/etc) | |                           |
| +--------^----------+ |                           |
|          |            |                           |
|          | (WSS)      |                           |
+----------|------------+                           |
           |                                        |
           | Connection 1                           |
           | (Encrypted)                            |
           | (API via Secure WebSocket)             |
           |                                        |
+----------v------------+                           |
|                       |                           |
| Your Node.js Server   |---------------------------+
| (HTTPS/WSS Server)    |
| (TCP Client for PvPGN)|
|                       |
+-----------------------+



## Tech Stack

*   **Backend:** Node.js
*   **Web Framework:** Express (minimal use for serving static files)
*   **WebSockets:** `ws` library
*   **TCP Networking:** Node.js `net` module
*   **Frontend:** HTML, CSS, Vanilla JavaScript
*   **Process Management (Recommended):** PM2

## Prerequisites

*   Node.js (v18.x or later recommended)
*   npm (usually comes with Node.js)
*   Git
*   OpenSSL (for generating self-signed certificates for local development)

## Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd pvpgn-web-chat
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```
    *Note: For production, use `npm install --production`.*

3.  **Set up SSL Certificates (for HTTPS/WSS):**
    *   **Development (Self-Signed):**
        1.  Create a `certs` directory: `mkdir certs`
        2.  Generate certificates using OpenSSL:
            ```bash
            openssl req -x509 -newkey rsa:2048 -nodes -sha256 -keyout certs/key.pem -out certs/cert.pem -days 365
            ```
            *(Fill in the prompts or press Enter for defaults. Use `localhost` for "Common Name".)*
        3.  **Important:** Add `certs/` to your `.gitignore` file!
    *   **Production:** Obtain valid certificates using a service like Let's Encrypt (recommended) or from a Certificate Authority. Place the `key.pem` and `cert.pem` (or equivalent files) in a secure location accessible by the Node.js server and update the paths in `server/server.js` if necessary.

4.  **Configure Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file:
        ```dotenv
        # .env
        NODE_ENV=development # Change to 'production' for deployment
        PORT=3443          # Port for HTTPS/WSS server (use 443 for standard HTTPS if possible/configured)
        ```
    *   **Important:** Add `.env` to your `.gitignore` file!

## Running the Application

### Development

1.  **Start the server:**
    ```bash
    npm start
    ```
2.  **Access the client:** Open your browser and navigate to `https://localhost:<PORT>` (e.g., `https://localhost:3443`).
3.  **Accept Security Warning:** Your browser will likely show a security warning because you are using a self-signed certificate. Find the option to proceed (e.g., "Advanced" -> "Proceed to localhost (unsafe)").

### Production (Recommended: using PM2)

1.  **Install PM2 globally:**
    ```bash
    npm install pm2 -g
    ```
2.  **Start the application with PM2:** From your project directory on the server:
    ```bash
    pm2 start server/server.js --name pvpgn-web-chat
    ```
3.  **Ensure PM2 restarts on server reboot:**
    ```bash
    pm2 startup
    # Follow the instructions output by the command above (may require sudo)
    pm2 save
    ```
4.  **Configure Firewall:** Ensure the `PORT` specified in your `.env` file (e.g., 443 or 3443) is open for incoming TCP connections on your server's firewall.
5.  **Access:** Users can now access the application via `https://<your_server_ip_or_domain>:<PORT>`.

## Security Considerations

*   **HTTPS/WSS:** **Enabled by default.** This encrypts communication between the user's browser and your Node.js server, protecting login credentials and chat messages during transit over the internet. **Do not disable this in production.**
*   **Node.js <-> PvPGN Connection:** The connection between your Node.js server and the external PvPGN server uses plain TCP as required by the PvPGN text protocol (`0x03`). This part of the communication is **not encrypted**.
*   **Password Handling:** Passwords are sent encrypted from the browser to your Node.js server (WSS) but are then sent in plain text from your Node.js server to the PvPGN server (TCP).
    *   **Advise users strongly against reusing important passwords.**
    *   The Node.js server does not store passwords after the authentication attempt.
    *   Ensure server logs do not inadvertently log sensitive information.
*   **Input Validation & Output Sanitization:** Basic input validation should be performed on the backend. All user-generated content or data received from the PvPGN server is escaped (`escapeHtml`) on the frontend before rendering to prevent Cross-Site Scripting (XSS).
*   **Rate Limiting:** Consider implementing rate limiting on the Node.js server (WebSocket connections, login attempts, chat messages) to mitigate brute-force attacks and spam. (Currently *not* implemented).
*   **Dependencies:** Regularly check for vulnerabilities in dependencies using `npm audit` and keep them updated (`npm update`).

## Future Enhancements / TODO

*   [ ] Improve UI/UX (e.g., using a CSS framework like Materialize or Tailwind).
*   [ ] Better visual distinction for different message types (whispers, system info, errors).
*   [ ] Implement more chat commands (`/whois`, `/whereis`, `/ignore`, etc.).
*   [ ] Add UI elements for whispering (e.g., right-click user list).
*   [ ] More robust error handling and feedback in the UI.
*   [ ] Implement backend rate limiting.
*   [ ] Add keep-alive/ping mechanism specifically for the WebSocket connection if needed (separate from the PvPGN keep-alive).
*   [ ] Explore native app support (iOS/Android/Desktop) using this Node.js backend via WSS.

## Contributing

Contributions are welcome! Please feel free to:

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/your-feature-name`).
3.  Make your changes.
4.  Commit your changes (`git commit -am 'Add some feature'`).
5.  Push to the branch (`git push origin feature/your-feature-name`).
6.  Create a new Pull Request.

Please report any bugs or suggest features using the repository's issue tracker.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. *(Make sure you add a LICENSE file with the MIT license text)*

## Acknowledgements

*   Inspired by the original Rust PvPGN chat client project.
*   PvPGN project for the server emulation.
*   Node.js, Express, ws library contributors.
