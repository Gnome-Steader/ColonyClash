# ColonyClash 🐜⚔️

[![License](https://img.shields.io/badge/License-Custom%20Restrictions-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Game Status](https://img.shields.io/badge/Status-Playable-brightgreen.svg)]()
[![GitHub Stars](https://img.shields.io/github/stars/Gnome-Steader/ColonyClash?style=social)](https://github.com/Gnome-Steader/ColonyClash/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Gnome-Steader/ColonyClash?style=social)](https://github.com/Gnome-Steader/ColonyClash/network/members)

ColonyClash is a real-time multiplayer ant colony simulation game where players build and command ant colonies to compete against each other in a battle for survival. Control queens, workers, and soldiers to forage, defend, and attack on a shared map. Built using **Node.js**, **Socket.IO**, and **HTML5 Canvas**, this game offers a dynamic and competitive strategy experience directly in your web browser.

---

## Key Features

-   **Real-time Multiplayer:** Engage with other players on a live, shared game map, fostering dynamic interactions and competition.
-   **Strategic Colony Management:** Command queens, workers, and soldiers to expand your territory, gather resources, and defend your nest.
-   **Dynamic Resource Foraging:** Strategically direct workers to forage for food and other resources essential for colony growth and unit production.
-   **Intense PvP Battles:** Orchestrate complex attacks and defenses against rival ant colonies using your soldier units.
-   **HTML5 Canvas Graphics:** Enjoy fluid, browser-based gameplay with rich visuals rendered directly in your web browser, requiring no external downloads.
-   **Node.js & Socket.IO Backend:** Experience low-latency, real-time communication for smooth and responsive gameplay, ensuring every command is executed precisely.

---

## Technologies Used

### Languages

-   JavaScript
- HTML5
- CSS

### Tools & Frameworks

-   Node.js
-   Socket.IO
-   HTML5 Canvas

---

## Prerequisites

Before you can run ColonyClash, ensure you have the following installed on your system:

-   **Node.js**: Version 18 or higher is recommended.
    -   [Download Node.js](https://nodejs.org/en/download/)
-   **npm** (Node Package Manager): Typically comes bundled with Node.js.

---

## Installation & Setup

Follow these steps to get ColonyClash up and running on your local machine:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/Gnome-Steader/ColonyClash.git
    cd ColonyClash
    ```

2.  **Install Dependencies:**
    Navigate into the project directory and install all required Node.js packages:
    ```bash
    npm install
    ```

3.  **Start the Game Server:**
    Once dependencies are installed, you can start the game server:
    ```bash
    npm start
    ```
    The server should now be running, typically on `http://localhost:3000` (or another port if specified in the application configuration).

4.  **Access the Game:**
    Open your favorite web browser and navigate to the address where the server is running (e.g., `http://localhost:3000`).

---

## Usage

Once the server is running and you've accessed the game in your browser, you can start playing:

-   **Join a Game:** You'll be prompted to join an existing game room or create a new one.
-   **Command Your Colony:** Use the intuitive in-game interface to direct your ant units:
    -   Send **workers** to forage for food and other vital resources to sustain and grow your colony.
    -   Position **soldiers** strategically for defense against invaders or to launch an attack on rival colonies.
    -   Manage your **queen** to lay eggs, expanding your population and unlocking new units.
-   **Compete:** Strategize to outmaneuver and defeat rival ant colonies, dominating the shared map and ensuring your colony's survival.

### API Documentation

ColonyClash leverages **Socket.IO** for all real-time communication between the client (web browser) and the server (Node.js). While formal API endpoint documentation is not provided externally, the core interaction revolves around emitting and listening to custom events for various game actions (e.g., `moveAnt`, `attackTarget`, `collectResource`, `buildNest`).

Developers interested in understanding the client-server communication protocols can inspect the source code, particularly the Socket.IO event handlers on both the server and client sides, to see how game state changes are propagated and managed.

---

## Configuration

Currently, ColonyClash offers minimal external configuration options. Key settings such as the server port or specific game parameters are typically defined within the server-side JavaScript files.

-   **Server Port:** The default port is usually configured within the main server file (e.g., `app.js` or `server.js`). You might be able to change it by modifying the relevant code directly or by setting an environment variable (e.g., `PORT=8080 npm start`) if that functionality has been implemented.

---

## Contributing

We welcome and appreciate contributions from the community! If you'd like to contribute to ColonyClash, please follow these guidelines:

1.  **Fork the repository.**
2.  **Create a new branch** for your feature or bug fix:
    ```bash
    git checkout -b feature/your-feature-name
    # or for bug fixes
    git checkout -b bugfix/issue-description
    ```
3.  **Make your changes.**
4.  **Commit your changes** with a clear and concise message following conventional commits if possible (e.g., `feat: Add new game mechanic`, `fix: Resolve movement bug`).
    ```bash
    git commit -m "feat: Add new game mechanic for resource management"
    ```
5.  **Push to your fork:**
    ```bash
    git push origin feature/your-feature-name
    ```
6.  **Open a Pull Request** to the `main` branch of the original repository.

Please ensure your code adheres to existing coding styles and conventions, and includes relevant tests if applicable.

---

## License

This project is licensed under a custom license with specific restrictions. Please refer to the [LICENSE](LICENSE) file in the root of this repository for full details.

---

Made with ❤ by Gnome-Steader
