# Colony Clash

[![License](https://img.shields.io/badge/License-Custom%20Restrictions-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Game Status](https://img.shields.io/badge/Status-Playable-brightgreen.svg)]()

A real-time multiplayer ant colony simulation game where players build and command ant colonies to compete against each other in a battle for survival. Control queens, workers, and soldiers to forage, defend, and attack on a shared map. Experience the thrill of colony management in a dynamic, competitive environment!

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Demo](#demo)
- [Requirements](#requirements)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [How to Play](#how-to-play)
- [Game Mechanics](#game-mechanics)
- [Controls](#controls)
- [Strategies](#strategies)
- [Technologies](#technologies)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Changelog](#changelog)
- [Credits](#credits)
- [License](#license)
- [Support](#support)

## Description

In **Colony Clash**, players control ant colonies on a vast shared map. Each colony begins with a queen ant that produces worker and soldier ants. Workers gather essential resources like food and meat to sustain and grow the colony, while soldiers protect the queen and engage in combat with enemy ants and beetles.

The game combines strategy, real-time action, and multiplayer competition. Survive by building a strong colony, managing resources efficiently, and outmaneuvering opponents. Will your colony rise to dominance, or be crushed under the weight of rival ants?

Key themes include:
- **Survival**: Protect your queen at all costs.
- **Resource Management**: Balance foraging, production, and defense.
- **Combat**: Engage in tactical battles with enemies.
- **Multiplayer Dynamics**: Collaborate or compete in real-time with other players.

## Features

- **Real-time Multiplayer**: Connect with friends and battle live using WebSockets (Socket.IO). Supports multiple players on the same server.
- **Ant Types**:
  - **Queen**: The heart of your colony. Produces new ants using food and meat resources. If the queen dies, the game ends for that player.
  - **Workers**: Essential for gathering. They collect food and meat, and can steal enemy brood to expand your colony.
  - **Soldiers**: Elite defenders. They protect the queen, patrol areas, and attack enemies aggressively.
- **Commands**:
  - **Forage**: Send ants to search for food and meat across the map.
  - **Home**: Order all ants to return to the queen for safety.
  - **Guard Home**: Defend the queen's immediate area against threats.
  - **Guard Area**: Protect a specific location by stationing ants there.
  - **Attack**: Command ants to aggressively hunt down enemies.
  - **Follow**: Have ants follow a player-controlled ant for coordinated movements.
- **Enemies**: Wild beetles roam the map. Defeating them provides valuable meat resources.
- **Resources**:
  - **Food**: Used to produce worker ants. Essential for colony growth.
  - **Meat**: Required for soldier ants. Critical for defense and offense.
- **Spatial Optimization**: Utilizes a grid-based system for efficient entity management, collision detection, and rendering. Ensures smooth performance even with many ants on screen.
- **Persistent Sessions**: Games continue until only one colony survives.
- **Cross-Platform**: Runs in any modern web browser with HTML5 support.

## Demo

Experience Colony Clash live! Play the game online at: [https://ColonyClash.onrender.com](https://ColonyClash.onrender.com)

*Note: The demo is hosted on Render and may have uptime limitations. For the best experience, run the game locally.*

## Requirements

- **Node.js**: Version 18 or higher. Download from [nodejs.org](https://nodejs.org/).
- **npm**: Comes bundled with Node.js.
- **Web Browser**: Modern browser with WebSocket support (e.g., Chrome, Firefox, Edge).
- **Internet Connection**: Required for multiplayer mode and initial setup.

## Installation

Follow these steps to set up Colony Clash on your local machine:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/Gnome-Steader/ColonyClash.git
   cd ColonyClash
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```
   This will install all necessary packages, including Express, Socket.IO, and others.

3. **Start the Server**:
   ```bash
   npm start
   ```
   The server will start on port 3000 by default. You can change the port by setting the `PORT` environment variable.

4. **Access the Game**:
   Open your web browser and navigate to `http://localhost:3000` (or the specified port).

5. **Optional: Development Mode**:
   For development with auto-restart:
   ```bash
   npm run dev
   ```
   *Note: You may need to install nodemon globally if not already available: `npm install -g nodemon`*

## Getting Started

- **Single Player**: Start the server and connect alone. The game will begin when at least one player is present, but multiplayer is recommended for full enjoyment.
- **Multiplayer**: Share the server URL with friends. Each player connects via their browser. The game starts automatically when multiple players join.
- **Joining a Game**: Click "Join Game" or similar button on the homepage. You'll spawn with your initial worker ant.
- **Objective**: Build your colony, gather resources, and eliminate rival queens while protecting your own.

## How to Play

1. **Spawn**: Begin with a queen and one worker ant.
2. **Control Your Ant**: Use keyboard and mouse to move and interact.
3. **Gather Resources**: Send workers to forage for food and meat.
4. **Produce Ants**: Use resources at the queen to create more workers or soldiers.
5. **Defend and Attack**: Assign soldiers to guard or attack as needed.
6. **Survive**: Keep your queen alive while targeting others.
7. **Victory**: Be the last colony standing.

## Game Mechanics

### Ant Production
- Queens produce ants based on available resources.
- Workers cost food; soldiers cost meat.
- Production time varies by ant type (workers faster than soldiers).

### Resource System
- Food spawns randomly on the map.
- Meat is obtained from defeated beetles or stolen brood.
- Resources are finite and regenerate over time.

### Combat
- Soldiers attack with melee strikes.
- Damage is based on ant type and health.
- Ants have health points; defeated ants drop resources or brood.

### Map Dynamics
- Shared world with roaming beetles.
- Grid-based movement for precise positioning.
- Boundaries prevent ants from wandering off-map.

### Multiplayer Interactions
- Players can steal brood from enemy colonies.
- No friendly fire; ants only target enemies.
- Real-time updates ensure synchronized gameplay.

## Controls

- **Movement**: WASD keys to move your controlled ant.
- **Camera**: Mouse to pan the view.
- **Attack**: Left-click to attack nearby enemies.
- **Commands**: Use on-screen buttons or hotkeys (e.g., F for Forage, H for Home).
- **Select Ants**: Click on ants to take control or issue commands.

*Full control scheme available in-game via the help menu.*

## Strategies

- **Early Game**: Focus on foraging to build a worker army.
- **Mid Game**: Produce soldiers to defend while expanding.
- **Late Game**: Aggressive attacks on weak colonies.
- **Defense**: Guard your queen and key resource areas.
- **Offense**: Scout enemy positions and strike vulnerable spots.
- **Resource Balance**: Maintain a mix of workers and soldiers.

## Technologies

- **Backend**: Node.js with Express for server logic, Socket.IO for real-time communication.
- **Frontend**: HTML5 Canvas for 2D rendering and game loop.
- **Networking**: WebSockets for low-latency multiplayer.
- **Deployment**: Hosted on Render for easy access.

## Architecture

The game uses a client-server architecture:

- **Server**: Handles game state, entity updates, and broadcasts to clients.
- **Client**: Renders the game world, sends inputs to server.
- **Entities**: Managed in a grid for efficient collision and updates.
- **Real-time Sync**: Socket.IO ensures all players see the same state.

For more technical details, see the source code in `server.js` and `public/`.

## Contributing

Contributions are welcome! We encourage community involvement to improve Colony Clash.

1. **Fork the Repository**: Create your own fork.
2. **Create a Branch**: `git checkout -b feature/your-feature`
3. **Make Changes**: Implement your feature or fix.
4. **Test**: Ensure the game runs correctly.
5. **Submit a Pull Request**: Describe your changes clearly.

Please follow these guidelines:
- Keep code clean and commented.
- Test multiplayer scenarios.
- Respect the license restrictions.

## Development

### Project Structure
```
ColonyClash/
├── server.js          # Main server file
├── public/            # Client-side files
│   ├── index.html     # Game HTML
│   ├── style.css      # Game styles
│   └── game.js        # Client game logic
├── package.json       # Dependencies and scripts
└── README.md          # This file
```

### Adding Features
- Server-side changes in `server.js`.
- Client updates in `public/game.js`.
- UI changes in `public/index.html` and `style.css`.

### Testing
- Run locally and test with multiple browser tabs.
- Check console for errors.
- Validate multiplayer sync.

## Troubleshooting

- **Server Won't Start**: Ensure Node.js 18+ is installed. Check for port conflicts.
- **Game Not Loading**: Clear browser cache. Ensure WebSockets are enabled.
- **Lag in Multiplayer**: Check internet connection. Server may be overloaded.
- **Ants Not Responding**: Verify commands are issued correctly. Check client-server connection.
- **Errors in Console**: Look for specific error messages and search issues or contact support.

## FAQ

**Q: Can I play solo?**  
A: Yes, but the game is designed for multiplayer. Solo mode allows testing.

**Q: How many players can join?**  
A: Unlimited in theory, but performance may degrade with many players.

**Q: Is the game free?**  
A: Yes, for personal use. See license for restrictions.

**Q: Can I modify the game?**  
A: For personal use or pull requests only. No redistribution.

**Q: Why ants?**  
A: Ant colonies are fascinating systems of cooperation and competition!

## Changelog

### Version 1.0.0 (Latest)
- Initial release with core gameplay.
- Real-time multiplayer support.
- Basic ant types and commands.
- Hosted demo on Render.

*For older versions, check git history.*

## Credits

- **Developer**: Gnome-Steader
- **Inspiration**: Real ant colony behaviors, strategy games like Civilization.
- **Libraries**: Socket.IO, Express, and other npm packages.
- **Community**: Thanks to early testers and contributors.

## License

Copyright © Gnome-Steader 2026

Permission is granted to any user to download, install, and run this project for personal use only.

The following restrictions apply:

- **No Redistribution**: You may not copy, upload, mirror, publish, or otherwise redistribute this project or any of its files in any form.
- **No Commercial Use**: You may not sell, license, rent, monetize, or use this project or any part of it for commercial purposes.
- **No Derivative Distribution**: You may not distribute modified versions, forks, or derivative works of this project.
- **Pull Requests Allowed**: You may create modified versions only for the purpose of submitting pull requests to the official repository. Creating forks or modifications for any other purpose is prohibited.
- **No Asset Extraction**: You may not extract, reuse, or repurpose any assets (including art, code, audio, or writing) outside of this project.
- **Ownership**: All rights, title, and interest in this project remain with the copyright holder.

By using this project, you agree to these terms.

## Support

- **Issues**: Report bugs or request features via [GitHub Issues](https://github.com/Gnome-Steader/ColonyClash/issues).
- **Discussions**: Join community talks on [GitHub Discussions](https://github.com/Gnome-Steader/ColonyClash/discussions).
- **Contact**: Reach out via GitHub profile.

Enjoy Colony Clash! May the strongest colony win.
