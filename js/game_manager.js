function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator       = new Actuator;
  this.lastDir        = 0; //0: up, 1: right, 2: down, 3: left

  this.startTiles     = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));

  this.setup();
}

// Restart the game
GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();
};

// Keep playing after winning (allows going over 2048)
GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

// Set up the game
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  // Reload the game from a previous game if present
  if (previousState) {
    this.grid        = new Grid(previousState.grid.size,
                                previousState.grid.cells); // Reload grid
    this.score       = previousState.score;
    this.over        = previousState.over;
    this.won         = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
  } else {
    this.grid        = new Grid(this.size);
    this.score       = 0;
    this.over        = false;
    this.won         = false;
    this.keepPlaying = false;

    // Add the initial tiles
    this.addStartTiles();
  }

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addEasyTile();
  }
};

// Adds a tile in optimal position
GameManager.prototype.addEasyTile = function () {
  if (this.grid.cellsAvailable()) {
    //TODO:
    //current strat: always add a tile w value 2, but add tile of 4 is 2 will result in game over
    //this makes gameplay slower, but yields a higher score
    //add tiles to the border opposite of the last move, to avoid rectangle formation
    //add in same col/row as smallest tile for endgame strats

    var value = 2;
    var vector = this.getVector(this.lastDir);

    var avail = [];  //only look at opposite border, guaranteed to have *something* free
    for (var i = 0; i < this.size; i++) {
      var cell = {x: i, y: i};
      if (this.lastDir == 0)
        cell.y = this.size - 1;
      else if (this.lastDir == 1)
        cell.x = 0;
      else if (this.lastDir == 2)
        cell.y = 0;
      else if (this.lastDir == 3)
        cell.x = this.size - 1;
      if (this.grid.cellAvailable(cell)) {
        avail.push(cell);
      }
    }
    if (this.grid.cellsAvailable==1 && !this.tileMatchesAvailable()) {
      //possible game over condition, if no surrounding 2's then spawn a 4
      //if the 4 won't save you, use a 2, you're dead anyway
      var cell = avail[0];
      var twos = 0;
      var fours = 0;
      for (var i = 0; i < 4; i++) {
        var dir = this.getVector(i);
        var cell2 = {x: cell.x + dir.x, y: cell.y + dir.y};
        if (this.grid.withinBounds(cell2)) {
          var tile = this.grid.cellContent(cell2);
          if (tile.value == 2)
            twos++;
          else if (tile.value == 4)
            fours++;
        }
      }
      if (!twos && fours)
        value = 4;
    }

    var bestval = 131073; //2^17+1, guaranteed to be biggest
    var bestchoices = [];
    for (var i = 0; i < avail.length; i++) {
      var cell = avail[i];
      for (var j = 0; j < this.size; j++) {
        var cell2 = {x: cell.x, y: cell.y};
        cell2.x += vector.x * j;
        cell2.y += vector.y * j;
        if (this.grid.cellContent(cell2)) {
          if (this.grid.cellContent(cell2).value < bestval) {
            bestval = this.grid.cellContent(cell2).value;
            bestchoices = [cell];
          } else if (this.grid.cellContent(cell2).value == bestval) {
            bestchoices.push(cell);
          }
          break;
        }
        if (j == this.size - 1) {
          if (bestval != 0)
            bestchoices = [];
          bestval = 0;
          bestchoices.push(cell);
        }
      }
    }
    var cellindex = Math.floor(Math.random() * bestchoices.length);
    var tile = new Tile(bestchoices[cellindex], value);
    this.grid.insertTile(tile);
  }
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    bestScore:  this.storageManager.getBestScore(),
    terminated: this.isGameTerminated()
  });

};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    keepPlaying: this.keepPlaying
  };
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  // 0: up, 1: right, 2: down, 3: left
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next      = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          self.score += merged.value;

          // The mighty 2048 tile
          if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    this.lastDir = direction; // Save the last move direction
    this.addEasyTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    this.actuate();
  }
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0,  y: -1 }, // Up
    1: { x: 1,  y: 0 },  // Right
    2: { x: 0,  y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
           this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      var tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        // Check all four directions
        for (var direction = 0; direction < 4; direction++) {
          var vector = this.getVector(direction);
          var cell = { x: x + vector.x, y: y + vector.y };

          // Traverse along the direction to find mergeable tiles
          while (this.grid.withinBounds(cell)) {
            var other = this.grid.cellContent(cell);
            if (other) {
              if (other.value === tile.value) {
                return true; // Merge is possible
              }
              break; // Stop if a non-mergeable tile is found
            }
            cell.x += vector.x;
            cell.y += vector.y;
          }
        }
      }
    }
  }
  return false; // No merges available
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};
