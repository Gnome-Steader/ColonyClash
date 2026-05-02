# Colony Clash

A real-time multiplayer ant colony simulation game where players build and command ant colonies to compete against each other in a battle for survival.

## Description

In Colony Clash, players control ant colonies on a shared map. Each colony starts with a queen that produces worker and soldier ants. Workers forage for food to grow the colony, while soldiers defend against threats. The game features beetles as neutral enemies that drop meat for stronger ant production. The objective is to eliminate all rival queens to win.

## Features

- **Real-time Multiplayer**: Connect with friends and battle in real-time using WebSockets (Socket.IO).
- **Ant Types**:
  - **Queen**: Produces new ants using food and meat resources.
  - **Workers**: Gather food and meat, steal enemy brood.
  - **Soldiers**: Defend the colony and attack enemies.
- **Commands**:
  - **Forage**: Ants search for food and meat.
  - **Home**: All ants return to the queen.
  - **Guard Home**: Defend the queen's area.
  - **Guard Area**: Protect a specific location.
  - **Attack**: Aggressively hunt enemies.
  - **Follow**: Ants follow the player-controlled ant.
- **Enemies**: Beetles roam the map and provide meat when defeated.
- **Resources**: Food for workers, meat for soldiers.
- **Spatial Optimization**: Uses a grid-based system for efficient entity management and rendering.

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/Gnome-Steader/ColonyClash.git
   cd ColonyClash
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open your browser and navigate to `http://localhost:3000` (or the port specified).

## How to Play

- Connect to the server (requires at least 2 players to start the game).
- Control your starting worker ant using WASD keys to move and mouse to aim/attack.
- Gather resources to grow your colony.
- Use commands to strategize: forage for resources, guard your queen, or attack enemies.
- Survive by protecting your queen while eliminating others.

## Technologies

- **Backend**: Node.js with Express and Socket.IO for real-time multiplayer.
- **Frontend**: HTML5 Canvas for rendering the game world.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull requests.

## License

Copyright © Gnome-Steader 2026

Permission is granted to any user to download, install, and run this project for personal use only.

The following restrictions apply:

No Redistribution — You may not copy, upload, mirror, publish, or otherwise redistribute this project or any of its files in any form.

No Commercial Use — You may not sell, license, rent, monetize, or use this project or any part of it for commercial purposes.

No Derivative Distribution — You may not distribute modified versions, forks, or derivative works of this project.

Pull Requests Allowed — You may create modified versions only for the purpose of submitting pull requests to the official repository. Creating forks or modifications for any other purpose is prohibited.

No Asset Extraction — You may not extract, reuse, or repurpose any assets (including art, code, audio, or writing) outside of this project.

Ownership — All rights, title, and interest in this project remain with the copyright holder.

By using this project, you agree to these terms.
