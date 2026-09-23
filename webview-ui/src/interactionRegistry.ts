export interface InteractionSlot {
  type: string;
  capacity: number;
  occupant: string | null;
  occupants?: string[];
}

export class InteractionRegistry {
  private slots = new Map<string, InteractionSlot>();

  replace(slots: InteractionSlot[], eligible: (characterId: string, type: string) => boolean = () => true): void {
    const previous = this.slots;
    const next = new Map<string, InteractionSlot>();
    for (const slot of slots) {
      const prior = previous.get(slot.type);
      const members = (prior ? this.members(prior) : this.members(slot))
        .filter((characterId) => eligible(characterId, slot.type))
        .slice(0, slot.capacity);
      this.assign(slot, members);
      next.set(slot.type, slot);
    }
    this.slots = next;
  }

  reserve(type: string, characterId: string): boolean {
    const slot = this.slots.get(type);
    if (!slot) return false;
    const members = this.members(slot);
    if (members.includes(characterId)) return true;
    if (members.length >= slot.capacity) return false;
    this.releaseCharacter(characterId);
    this.assign(slot, [...members, characterId]);
    return true;
  }

  releaseCharacter(characterId: string, when: (type: string) => boolean = () => true): void {
    for (const slot of this.slots.values()) {
      if (when(slot.type)) this.assign(slot, this.members(slot).filter((member) => member !== characterId));
    }
  }

  occupants(type: string): string[] {
    const slot = this.slots.get(type);
    return slot ? this.members(slot) : [];
  }

  has(type: string, characterId: string): boolean {
    return this.occupants(type).includes(characterId);
  }

  available(type: string): boolean {
    const slot = this.slots.get(type);
    return !!slot && this.members(slot).length < slot.capacity;
  }

  private members(slot: InteractionSlot): string[] {
    return slot.capacity === 1 ? (slot.occupant ? [slot.occupant] : [])
      : slot.occupants ?? (slot.occupant ? [slot.occupant] : []);
  }

  private assign(slot: InteractionSlot, members: string[]): void {
    slot.occupant = members[0] ?? null;
    if (slot.capacity > 1) slot.occupants = members;
  }
}