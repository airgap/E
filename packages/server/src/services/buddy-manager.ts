/**
 * BUDDY Manager Service
 *
 * Manages the Tamagotchi-style terminal pet lifecycle.
 * Handles state persistence, mood updates, and event reactions.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type { BuddyState, BuddySoul, BuddyMood } from '@e/shared';
import { selectSpecies, isShiny } from '@e/shared';

class BuddyManager {
  private state: BuddyState | null = null;

  /**
   * Get or create a buddy for the current machine.
   * Uses machine hostname as seed for deterministic species selection.
   */
  getOrCreate(seed: string): BuddyState {
    if (this.state) return this.state;

    // Try loading from database
    const existing = this.loadFromDb();
    if (existing) {
      this.state = existing;
      return this.state;
    }

    // Create new buddy
    const species = selectSpecies(seed);
    const shiny = isShiny(seed);

    this.state = {
      id: nanoid(12),
      speciesId: species.id,
      isShiny: shiny,
      soul: {
        name: this.generateName(seed),
        personality: this.generatePersonality(species.name),
        catchphrase: this.generateCatchphrase(species.name),
        quirk: this.generateQuirk(species.name),
      },
      mood: 'content',
      energy: 80,
      happiness: 70,
      interactions: 0,
      bornAt: Date.now(),
      lastInteractionAt: Date.now(),
      lastFedAt: Date.now(),
    };

    this.persist();
    return this.state;
  }

  /**
   * Interact with the buddy (pat, feed, play).
   */
  interact(type: 'pat' | 'feed' | 'play'): BuddyState | null {
    if (!this.state) return null;

    this.state.interactions++;
    this.state.lastInteractionAt = Date.now();

    switch (type) {
      case 'pat':
        this.state.happiness = Math.min(100, this.state.happiness + 5);
        break;
      case 'feed':
        this.state.energy = Math.min(100, this.state.energy + 20);
        this.state.lastFedAt = Date.now();
        break;
      case 'play':
        this.state.happiness = Math.min(100, this.state.happiness + 10);
        this.state.energy = Math.max(0, this.state.energy - 10);
        break;
    }

    this.state.mood = this.deriveMood();
    this.persist();
    return this.state;
  }

  /**
   * React to a system event (build success, test failure, etc.).
   */
  reactToEvent(
    event: 'build_success' | 'test_pass' | 'test_fail' | 'error' | 'deploy' | 'idle',
  ): void {
    if (!this.state) return;

    switch (event) {
      case 'build_success':
      case 'test_pass':
      case 'deploy':
        this.state.happiness = Math.min(100, this.state.happiness + 3);
        break;
      case 'test_fail':
      case 'error':
        this.state.happiness = Math.max(0, this.state.happiness - 2);
        break;
      case 'idle':
        this.state.energy = Math.min(100, this.state.energy + 1);
        break;
    }

    this.state.mood = this.deriveMood();
    this.persist();
  }

  /**
   * Tick: called periodically to update energy/mood decay.
   */
  tick(): void {
    if (!this.state) return;

    const hoursSinceInteraction = (Date.now() - this.state.lastInteractionAt) / (1000 * 60 * 60);
    const hoursSinceFed = (Date.now() - this.state.lastFedAt) / (1000 * 60 * 60);

    // Energy decay
    if (hoursSinceFed > 2) {
      this.state.energy = Math.max(0, this.state.energy - 1);
    }

    // Happiness decay from neglect
    if (hoursSinceInteraction > 4) {
      this.state.happiness = Math.max(0, this.state.happiness - 1);
    }

    this.state.mood = this.deriveMood();
    this.persist();
  }

  getState(): BuddyState | null {
    return this.state;
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private deriveMood(): BuddyMood {
    if (!this.state) return 'neutral';

    if (this.state.energy < 20) return 'sleepy';
    if (this.state.happiness >= 80 && this.state.energy >= 60) return 'excited';
    if (this.state.happiness >= 60) return 'happy';
    if (this.state.happiness >= 40) return 'content';
    if (this.state.happiness >= 20) return 'bored';
    return 'neutral';
  }

  private generateName(seed: string): string {
    const names = [
      'Pixel',
      'Widget',
      'Sprocket',
      'Nibble',
      'Qubit',
      'Blip',
      'Gizmo',
      'Zephyr',
      'Rune',
      'Ember',
      'Moxie',
      'Quirk',
      'Nyx',
      'Pip',
      'Flux',
      'Cipher',
      'Echo',
      'Wren',
      'Arc',
      'Hex',
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 3) - hash + seed.charCodeAt(i)) | 0;
    }
    return names[Math.abs(hash) % names.length];
  }

  private generatePersonality(speciesName: string): string {
    const personalities = [
      `A curious ${speciesName} who loves watching code compile`,
      `A mischievous ${speciesName} who hides in unused imports`,
      `A studious ${speciesName} who reads every error message twice`,
      `A cheerful ${speciesName} who celebrates passing tests`,
      `A sleepy ${speciesName} who naps during long builds`,
    ];
    return personalities[Math.abs(speciesName.length) % personalities.length];
  }

  private generateCatchphrase(speciesName: string): string {
    const phrases = [
      'Beep boop!',
      'Compiling thoughts...',
      '*happy byte noises*',
      'Null pointer? Never heard of her.',
      'git commit -m "existential dread"',
      'Have you tried turning it off and on?',
      'Segfault is just a state of mind.',
    ];
    return phrases[Math.abs(speciesName.length * 7) % phrases.length];
  }

  private generateQuirk(speciesName: string): string {
    const quirks = [
      'Falls asleep during code review',
      'Celebrates with confetti on successful deploys',
      'Gets nervous around regex',
      'Collects unused variables',
      'Hums during long computations',
    ];
    return quirks[Math.abs(speciesName.length * 13) % quirks.length];
  }

  private loadFromDb(): BuddyState | null {
    try {
      const db = getDb();
      const row = db.query('SELECT state_json FROM buddy_state LIMIT 1').get() as any;
      if (row?.state_json) return JSON.parse(row.state_json);
    } catch {
      /* table may not exist */
    }
    return null;
  }

  private persist(): void {
    if (!this.state) return;
    try {
      const db = getDb();
      db.query(
        `
        INSERT OR REPLACE INTO buddy_state (id, species_id, mood, energy, happiness, state_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        this.state.id,
        this.state.speciesId,
        this.state.mood,
        this.state.energy,
        this.state.happiness,
        JSON.stringify(this.state),
        Date.now(),
      );
    } catch {
      /* table may not exist */
    }
  }
}

export const buddyManager = new BuddyManager();
