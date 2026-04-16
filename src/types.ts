export type StudyStatus = "new" | "correct" | "incorrect";

export type Flashcard = {
  id: string;
  front: string;
  back: string;
  drugName: string;
  category?: string;
  tags: string[];
  sourceRow: number;
};

export type DrugReferenceSection = {
  id: string;
  label: string;
  content: string;
};

export type DrugReference = {
  id: string;
  drugName: string;
  aliases: string[];
  sections: DrugReferenceSection[];
  searchText: string;
};

export type Deck = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  flashcards: Flashcard[];
  drugReferences: DrugReference[];
};

export type DeckProgress = {
  deckId: string;
  masteredCardIds: string[];
  missedCardIds: string[];
  recentDrugIds: string[];
  pinnedDrugIds: string[];
};

export type ImportFieldKey =
  | "drugName"
  | "front"
  | "back"
  | "type"
  | "category"
  | "tags"
  | "aliases"
  | "indication"
  | "dose"
  | "concentration"
  | "preparation"
  | "administration"
  | "monitoring"
  | "cautions"
  | "notes"
  | "ignore";

export type ParsedImport = {
  headers: string[];
  rows: string[][];
  suggestedName: string;
};
