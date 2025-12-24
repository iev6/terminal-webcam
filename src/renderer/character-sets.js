/**
 * ASCII character sets for terminal rendering
 * Each set maps brightness levels to different characters
 */

export const characterSets = [
  {
    name: 'Blocks',
    chars: ' ░▒▓█',
    description: 'Default block characters'
  },
  {
    name: 'Shades',
    chars: ' ▁▂▃▄▅▆▇█',
    description: 'Vertical shade blocks'
  },
  {
    name: 'Classic',
    chars: ' .:-=+*#%@',
    description: 'Classic ASCII art'
  },
  {
    name: 'Simple',
    chars: ' .oO@',
    description: 'Simple dots'
  },
  {
    name: 'Dense',
    chars: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
    description: 'High detail (70 levels)'
  },
  {
    name: 'Braille',
    chars: ' ⠁⠃⠇⠏⠟⠿⣿',
    description: 'Braille-like dots'
  },
  {
    name: 'Numeric',
    chars: ' 123456789@',
    description: 'Numbers 1-9'
  },
  {
    name: 'Hatching',
    chars: ' .\'":|/\\#',
    description: 'Hatching pattern'
  },
  {
    name: 'Matrix',
    chars: ' ▪▫◽◾■',
    description: 'Matrix-style squares'
  },
  {
    name: 'Minimal',
    chars: ' ·•',
    description: 'Minimal two-tone'
  }
];

/**
 * Character set manager for tracking active set
 */
export class CharacterSetManager {
  constructor() {
    this.currentIndex = 0;
  }

  getCurrentSet() {
    return characterSets[this.currentIndex];
  }

  next() {
    this.currentIndex = (this.currentIndex + 1) % characterSets.length;
    return this.getCurrentSet();
  }

  previous() {
    this.currentIndex = (this.currentIndex - 1 + characterSets.length) % characterSets.length;
    return this.getCurrentSet();
  }

  getName() {
    return this.getCurrentSet().name;
  }

  getChars() {
    return this.getCurrentSet().chars;
  }

  getDescription() {
    return this.getCurrentSet().description;
  }
}
