import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDeckFromImport,
  parseImportText,
  suggestFieldMapping
} from "./lib/importer";
import { createId } from "./lib/ids";
import {
  deleteDeck,
  ensureSeedDeck,
  getAppSetting,
  getDecks,
  getProgress,
  saveDeck,
  saveProgress,
  setAppSetting
} from "./lib/storage";
import type {
  Deck,
  DeckProgress,
  DrugReferenceSection,
  Flashcard,
  ImportFieldKey,
  ParsedImport
} from "./types";

const importOptions: ImportFieldKey[] = [
  "drugName",
  "front",
  "back",
  "type",
  "category",
  "tags",
  "aliases",
  "indication",
  "dose",
  "concentration",
  "preparation",
  "administration",
  "monitoring",
  "cautions",
  "notes",
  "ignore"
];

const LEGACY_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT2AU0SWUQCCt2F5ixm66b-P0hgb94EOYq7NlHM-B2ijn5gTReD4HNLIsncYPku--OIWM-TPpPWYclF/pub?gid=1025900712&single=true&output=tsv";
const LEGACY_IMPORT_KEY = "legacy-deck-imported";
const LEGACY_DECK_NAME = "Legacy Drug Sheet";
const COMMON_SECTION_LABELS = [
  "Indications",
  "Pre Meds",
  "Filter",
  "Assessment",
  "Route/Admin",
  "Observation",
  "Side Effects",
  "Notes"
] as const;

type ViewMode = "study" | "work";
type StudyFilter = "all" | "missed" | "mastered";
type CardEditDraft = {
  drugName: string;
  front: string;
  back: string;
  category: string;
  tags: string;
};
type DrugEditDraft = {
  drugName: string;
  aliases: string;
  sections: DrugReferenceSection[];
};

type DeckBackup = {
  version: 1;
  exportedAt: string;
  deck: Deck;
  progress: DeckProgress | null;
};

function normalizeList(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildSearchText(drugName: string, aliases: string[], sections: DrugReferenceSection[]): string {
  return [drugName, ...aliases, ...sections.map((section) => `${section.label} ${section.content}`)]
    .join(" ")
    .toLowerCase();
}

function buildQuestionForSection(drugName: string, label: string, aliases: string[] = []): string {
  const normalized = label.trim().toLowerCase();
  const primaryName = aliases.length > 0 ? `${drugName} (${aliases[0]})` : drugName;

  if (normalized === "indications" || normalized === "indication") {
    return `What are the indications for ${primaryName}?`;
  }

  if (normalized === "pre meds" || normalized === "pre-meds" || normalized === "premeds") {
    return `What are the Pre Meds for ${primaryName}?`;
  }

  if (normalized === "filter") {
    return `What is the filter for ${primaryName}?`;
  }

  if (normalized === "assessment") {
    return `What should be assessed upon arrival for a patient receiving ${primaryName}?`;
  }

  if (normalized === "route/admin" || normalized === "administration") {
    return `What is the route/admin for ${primaryName}?`;
  }

  if (normalized === "observation") {
    return `What observation is required for ${primaryName}?`;
  }

  if (normalized === "side effects") {
    return `What are the side effects of ${primaryName}?`;
  }

  if (normalized === "notes") {
    return `What are the notes for ${primaryName}?`;
  }

  return `What should you know about ${label} for ${primaryName}?`;
}

function buildFlashcardsFromSections(
  drugName: string,
  sections: DrugReferenceSection[],
  aliases: string[] = []
): Flashcard[] {
  return sections.map((section, index) => ({
    id: createId("card"),
    drugName,
    front: buildQuestionForSection(drugName, section.label, aliases),
    back: section.content,
    category: "Work Mode Generated",
    tags: ["generated"],
    sourceRow: index + 1
  }));
}

function isMalformedLegacyDeck(deck: Deck): boolean {
  if (deck.name !== LEGACY_DECK_NAME || deck.flashcards.length === 0) {
    return false;
  }

  return deck.flashcards.some((card) => {
    const combined = `${card.drugName} ${card.front} ${card.back}`;
    return (
      combined.includes("\t") ||
      /Summary\s+[A-Z][a-z]+/.test(combined) ||
      /Single\s+[A-Z][a-z]+/.test(combined) ||
      combined.length > 1200
    );
  });
}

function slugifyFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "deck-backup";
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState("");
  const [progress, setProgress] = useState<DeckProgress | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("study");
  const [studyFilter, setStudyFilter] = useState<StudyFilter>("all");
  const [studyDrugFilter, setStudyDrugFilter] = useState("");
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [workSearch, setWorkSearch] = useState("");
  const [selectedDrugId, setSelectedDrugId] = useState("");
  const [toast, setToast] = useState("");
  const [importName, setImportName] = useState("");
  const [importDraft, setImportDraft] = useState("");
  const [parsedImport, setParsedImport] = useState<ParsedImport | null>(null);
  const [fieldMapping, setFieldMapping] = useState<Record<number, ImportFieldKey>>({});
  const [isEditingCard, setIsEditingCard] = useState(false);
  const [cardEditDraft, setCardEditDraft] = useState<CardEditDraft | null>(null);
  const [isEditingDrug, setIsEditingDrug] = useState(false);
  const [drugEditDraft, setDrugEditDraft] = useState<DrugEditDraft | null>(null);
  const [isCreatingDrug, setIsCreatingDrug] = useState(false);
  const [newSectionLabel, setNewSectionLabel] = useState<string>(COMMON_SECTION_LABELS[0]);
  const workSearchRef = useRef<HTMLInputElement | null>(null);

  const activeDeck = useMemo(
    () => decks.find((deck) => deck.id === activeDeckId) ?? decks[0] ?? null,
    [activeDeckId, decks]
  );

  const pinnedIds = useMemo(() => new Set(progress?.pinnedDrugIds ?? []), [progress]);
  const recentIds = useMemo(() => new Set(progress?.recentDrugIds ?? []), [progress]);

  const studyCards = useMemo(() => {
    if (!activeDeck || !progress) {
      return [];
    }

    let cards = activeDeck.flashcards;

    if (studyFilter === "missed") {
      cards = cards.filter((card) => progress.missedCardIds.includes(card.id));
    } else if (studyFilter === "mastered") {
      cards = cards.filter((card) => progress.masteredCardIds.includes(card.id));
    }

    if (studyDrugFilter) {
      cards = cards.filter((card) => card.drugName === studyDrugFilter);
    }

    return cards;
  }, [activeDeck, progress, studyDrugFilter, studyFilter]);

  const currentCard = studyCards[currentCardIndex] ?? null;

  const filteredDrugs = useMemo(() => {
    if (!activeDeck) {
      return [];
    }

    const search = workSearch.trim().toLowerCase();
    const sorted = [...activeDeck.drugReferences].sort((left, right) => {
      const leftPinned = Number(pinnedIds.has(left.id));
      const rightPinned = Number(pinnedIds.has(right.id));
      if (leftPinned !== rightPinned) {
        return rightPinned - leftPinned;
      }

      const leftRecentIndex = progress?.recentDrugIds.indexOf(left.id) ?? -1;
      const rightRecentIndex = progress?.recentDrugIds.indexOf(right.id) ?? -1;
      const leftRecentScore = leftRecentIndex === -1 ? Number.MAX_SAFE_INTEGER : leftRecentIndex;
      const rightRecentScore = rightRecentIndex === -1 ? Number.MAX_SAFE_INTEGER : rightRecentIndex;
      if (leftRecentScore !== rightRecentScore) {
        return leftRecentScore - rightRecentScore;
      }

      return left.drugName.localeCompare(right.drugName);
    });

    if (!search) {
      return sorted;
    }

    const prefixMatches = sorted.filter((drug) => {
      const matchesName = drug.drugName.toLowerCase().startsWith(search);
      const matchesAlias = drug.aliases.some((alias) => alias.toLowerCase().startsWith(search));
      return matchesName || matchesAlias;
    });

    if (prefixMatches.length > 0) {
      return prefixMatches;
    }

    return sorted.filter((drug) => drug.searchText.includes(search));
  }, [activeDeck, pinnedIds, progress?.recentDrugIds, workSearch]);

  const alphabeticalDrugs = useMemo(
    () => [...filteredDrugs].sort((left, right) => left.drugName.localeCompare(right.drugName)),
    [filteredDrugs]
  );

  useEffect(() => {
    if (viewMode !== "work") {
      return;
    }

    if (alphabeticalDrugs.length === 0) {
      setSelectedDrugId("");
      return;
    }

    const currentStillVisible = alphabeticalDrugs.some((drug) => drug.id === selectedDrugId);
    if (!currentStillVisible) {
      setSelectedDrugId(alphabeticalDrugs[0].id);
    }
  }, [alphabeticalDrugs, selectedDrugId, viewMode]);

  const selectedDrug = useMemo(
    () => activeDeck?.drugReferences.find((drug) => drug.id === selectedDrugId) ?? filteredDrugs[0] ?? null,
    [activeDeck, filteredDrugs, selectedDrugId]
  );

  const selectedDrugStudyCount = useMemo(
    () =>
      selectedDrug
        ? activeDeck?.flashcards.filter((card) => card.drugName === selectedDrug.drugName).length ?? 0
        : 0,
    [activeDeck, selectedDrug]
  );

  const prioritizedSections = useMemo(() => {
    if (!selectedDrug) {
      return [];
    }

    const preferredOrder = [
      "Dose",
      "Administration",
      "Monitoring",
      "Cautions",
      "Indication",
      "Preparation",
      "Concentration",
      "Notes"
    ];

    return [...selectedDrug.sections].sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left.label);
      const rightIndex = preferredOrder.indexOf(right.label);
      const normalizedLeft = leftIndex === -1 ? preferredOrder.length : leftIndex;
      const normalizedRight = rightIndex === -1 ? preferredOrder.length : rightIndex;
      return normalizedLeft - normalizedRight;
    });
  }, [selectedDrug]);

  useEffect(() => {
    void (async () => {
      await ensureSeedDeck();
      let storedDecks = await getDecks();
      const legacyImported = await getAppSetting<boolean>(LEGACY_IMPORT_KEY);
      const existingLegacyDeck = storedDecks.find((deck) => deck.name === LEGACY_DECK_NAME);
      const needsLegacyRepair = existingLegacyDeck ? isMalformedLegacyDeck(existingLegacyDeck) : false;

      if (existingLegacyDeck && needsLegacyRepair) {
        const repairedDeck = await refreshLegacyDeck(existingLegacyDeck.id);
        if (repairedDeck) {
          storedDecks = await getDecks();
          setToast("Repaired the original drug sheet import.");
          setActiveDeckId(repairedDeck.id);
        }
      } else if (!legacyImported && storedDecks.length <= 1) {
        const legacyDeck = await refreshLegacyDeck();
        if (legacyDeck) {
          storedDecks = await getDecks();
          setToast("Imported the original drug sheet for offline use.");
          setActiveDeckId(legacyDeck.id);
        }
      }

      setDecks(storedDecks);
      if (storedDecks[0]) {
        setActiveDeckId((current) => current || storedDecks[0].id);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeDeck) {
      return;
    }

    void getProgress(activeDeck.id).then((storedProgress) => {
      setProgress(storedProgress);
      setSelectedDrugId(activeDeck.drugReferences[0]?.id ?? "");
      setCurrentCardIndex(0);
      setIsCardFlipped(false);
      setIsEditingCard(false);
      setCardEditDraft(null);
      setIsEditingDrug(false);
      setDrugEditDraft(null);
      setIsCreatingDrug(false);
    });
  }, [activeDeck]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const handler = () => setToast("Update available. Reload when convenient.");
    window.addEventListener("pwa-update-available", handler);
    return () => window.removeEventListener("pwa-update-available", handler);
  }, []);

  useEffect(() => {
    if (currentCardIndex >= studyCards.length) {
      setCurrentCardIndex(0);
    }
  }, [currentCardIndex, studyCards.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "/" && viewMode === "work") {
        event.preventDefault();
        workSearchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode]);

  async function reloadDecks(nextDeckId?: string) {
    const storedDecks = await getDecks();
    setDecks(storedDecks);
    setActiveDeckId(nextDeckId ?? activeDeckId ?? storedDecks[0]?.id ?? "");
  }

  async function updateProgress(updater: (current: DeckProgress) => DeckProgress): Promise<void> {
    if (!progress) {
      return;
    }

    const nextProgress = updater(progress);
    setProgress(nextProgress);
    await saveProgress(nextProgress);
  }

  async function persistDeck(updater: (deck: Deck) => Deck): Promise<Deck | null> {
    if (!activeDeck) {
      return null;
    }

    const updatedDeck = updater({
      ...activeDeck,
      updatedAt: new Date().toISOString()
    });

    await saveDeck(updatedDeck);
    setDecks((current) =>
      current
        .map((deck) => (deck.id === updatedDeck.id ? updatedDeck : deck))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    );

    return updatedDeck;
  }

  function backupActiveDeck() {
    if (!activeDeck) {
      setToast("No active deck to back up.");
      return;
    }

    const backup: DeckBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      deck: activeDeck,
      progress
    };

    downloadTextFile(
      `${slugifyFileName(activeDeck.name)}-backup.json`,
      JSON.stringify(backup, null, 2),
      "application/json"
    );
    setToast("Backup downloaded.");
  }

  function exportFlashcardsCsv() {
    if (!activeDeck) {
      setToast("No active deck to export.");
      return;
    }

    const headers = ["drugName", "front", "back", "category", "tags", "sourceRow"];
    const rows = activeDeck.flashcards.map((card) => [
      card.drugName,
      card.front,
      card.back,
      card.category ?? "",
      card.tags.join("; "),
      String(card.sourceRow)
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");

    downloadTextFile(
      `${slugifyFileName(activeDeck.name)}-flashcards.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    setToast("Flashcards CSV exported.");
  }

  function exportDrugReferencesCsv() {
    if (!activeDeck) {
      setToast("No active deck to export.");
      return;
    }

    const headers = ["drugName", "aliases", "sectionLabel", "sectionContent"];
    const rows = activeDeck.drugReferences.flatMap((drug) =>
      drug.sections.map((section) => [
        drug.drugName,
        drug.aliases.join("; "),
        section.label,
        section.content
      ])
    );
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");

    downloadTextFile(
      `${slugifyFileName(activeDeck.name)}-drug-reference.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    setToast("Drug reference CSV exported.");
  }

  async function importDeckFromUrl(
    url: string,
    suggestedName?: string,
    autoSave?: boolean
  ): Promise<Deck | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Import failed with status ${response.status}.`);
      }

      const content = await response.text();
      const parsed = parseImportText(content, suggestedName);
      const mapping = suggestFieldMapping(parsed.headers);

      if (autoSave) {
        const deck = buildDeckFromImport(suggestedName ?? parsed.suggestedName, parsed, mapping);
        if (deck.flashcards.length === 0 && deck.drugReferences.length === 0) {
          throw new Error("Imported data did not produce any cards or drug details.");
        }

        await saveDeck(deck);
        await setAppSetting(LEGACY_IMPORT_KEY, true);
        return deck;
      }

      setParsedImport(parsed);
      setImportDraft(content);
      setImportName(suggestedName ?? parsed.suggestedName);
      setFieldMapping(mapping);
      setToast("Remote import loaded. Review the field mapping before saving.");
      return null;
    } catch (error) {
      if (!autoSave) {
        setToast(error instanceof Error ? error.message : "Could not load remote import.");
      }

      return null;
    }
  }

  async function refreshLegacyDeck(existingDeckId?: string): Promise<Deck | null> {
    try {
      const response = await fetch(LEGACY_SHEET_URL);
      if (!response.ok) {
        throw new Error(`Import failed with status ${response.status}.`);
      }

      const content = await response.text();
      const parsed = parseImportText(content, `${LEGACY_DECK_NAME}.tsv`);
      const mapping = suggestFieldMapping(parsed.headers);
      const deck = buildDeckFromImport(LEGACY_DECK_NAME, parsed, mapping);
      const repairedDeck: Deck = {
        ...deck,
        id: existingDeckId ?? deck.id
      };

      await saveDeck(repairedDeck);
      await setAppSetting(LEGACY_IMPORT_KEY, true);
      return repairedDeck;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not refresh the legacy drug sheet.");
      return null;
    }
  }

  async function markCard(card: Flashcard, correct: boolean) {
    await updateProgress((current) => {
      const mastered = new Set(current.masteredCardIds);
      const missed = new Set(current.missedCardIds);

      if (correct) {
        mastered.add(card.id);
        missed.delete(card.id);
      } else {
        missed.add(card.id);
        mastered.delete(card.id);
      }

      return {
        ...current,
        masteredCardIds: [...mastered],
        missedCardIds: [...missed]
      };
    });

    setToast(correct ? "Marked correct" : "Marked for review");
    setIsCardFlipped(false);
    setCurrentCardIndex((index) => Math.min(index + 1, Math.max(studyCards.length - 1, 0)));
  }

  async function togglePin(drugId: string) {
    await updateProgress((current) => {
      const pinned = new Set(current.pinnedDrugIds);
      if (pinned.has(drugId)) {
        pinned.delete(drugId);
      } else {
        pinned.add(drugId);
      }

      return {
        ...current,
        pinnedDrugIds: [...pinned]
      };
    });
  }

  async function openDrug(drugId: string) {
    setSelectedDrugId(drugId);
    if (!progress) {
      return;
    }

    const recent = [drugId, ...progress.recentDrugIds.filter((item) => item !== drugId)].slice(0, 6);
    const nextProgress = {
      ...progress,
      recentDrugIds: recent
    };
    setProgress(nextProgress);
    await saveProgress(nextProgress);
  }

  function handleImportParse() {
    try {
      const parsed = parseImportText(importDraft);
      setParsedImport(parsed);
      setImportName(importName || parsed.suggestedName);
      setFieldMapping(suggestFieldMapping(parsed.headers));
      setToast("Import parsed. Review the field mapping.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not parse import.");
    }
  }

  async function handleFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const content = await file.text();
    try {
      const maybeBackup = JSON.parse(content) as Partial<DeckBackup>;
      if (
        maybeBackup &&
        maybeBackup.version === 1 &&
        maybeBackup.deck &&
        typeof maybeBackup.deck.id === "string" &&
        Array.isArray(maybeBackup.deck.flashcards) &&
        Array.isArray(maybeBackup.deck.drugReferences)
      ) {
        const restoredDeck: Deck = {
          ...maybeBackup.deck,
          updatedAt: new Date().toISOString()
        };
        await saveDeck(restoredDeck);

        if (maybeBackup.progress && maybeBackup.progress.deckId === restoredDeck.id) {
          await saveProgress(maybeBackup.progress);
        }

        await reloadDecks(restoredDeck.id);
        setToast(`Restored backup: ${restoredDeck.name}`);
        event.target.value = "";
        return;
      }
    } catch {
      // Non-backup files continue through the normal import flow.
    }

    try {
      const parsed = parseImportText(content, file.name);
      setParsedImport(parsed);
      setImportDraft(content);
      setImportName(parsed.suggestedName);
      setFieldMapping(suggestFieldMapping(parsed.headers));
      setToast(`Loaded ${file.name}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not read file.");
    }

    event.target.value = "";
  }

  async function loadFromUrl(url: string, suggestedName?: string) {
    await importDeckFromUrl(url, suggestedName, false);
  }

  async function saveImportedDeck() {
    if (!parsedImport) {
      setToast("Parse import content first.");
      return;
    }

    const finalName = importName || parsedImport.suggestedName;
    const deck = buildDeckFromImport(finalName, parsedImport, fieldMapping);
    if (deck.flashcards.length === 0 && deck.drugReferences.length === 0) {
      setToast("The mapping did not produce any cards or drug references.");
      return;
    }

    await saveDeck(deck);
    if (finalName === "Legacy Drug Sheet") {
      await setAppSetting(LEGACY_IMPORT_KEY, true);
    }
    await reloadDecks(deck.id);
    setParsedImport(null);
    setImportDraft("");
    setImportName("");
    setToast("Deck imported.");
  }

  async function removeDeck(deckId: string) {
    await deleteDeck(deckId);
    await reloadDecks();
    setToast("Deck deleted.");
  }

  function focusDrugInStudy(drugName: string) {
    setStudyDrugFilter(drugName);
    setStudyFilter("all");
    setCurrentCardIndex(0);
    setIsCardFlipped(false);
    setViewMode("study");
  }

  function startCardEdit() {
    if (!currentCard) {
      return;
    }

    setCardEditDraft({
      drugName: currentCard.drugName,
      front: currentCard.front,
      back: currentCard.back,
      category: currentCard.category ?? "",
      tags: currentCard.tags.join(", ")
    });
    setIsEditingCard(true);
  }

  async function saveCardEdit() {
    if (!activeDeck || !currentCard || !cardEditDraft) {
      return;
    }

    const previousDrugName = currentCard.drugName;
    const updatedDrugName = cardEditDraft.drugName.trim() || previousDrugName;
    await persistDeck((deck) => ({
      ...deck,
      flashcards: deck.flashcards.map((card) =>
        card.id === currentCard.id
          ? {
              ...card,
              drugName: updatedDrugName,
              front: cardEditDraft.front.trim(),
              back: cardEditDraft.back.trim(),
              category: cardEditDraft.category.trim() || undefined,
              tags: normalizeList(cardEditDraft.tags)
            }
          : card
      ),
      drugReferences: deck.drugReferences.map((drug) =>
        drug.drugName === previousDrugName
          ? {
              ...drug,
              drugName: updatedDrugName,
              searchText: buildSearchText(updatedDrugName, drug.aliases, drug.sections)
            }
          : drug
      )
    }));

    if (studyDrugFilter === previousDrugName) {
      setStudyDrugFilter(updatedDrugName);
    }
    setIsEditingCard(false);
    setCardEditDraft(null);
    setToast("Flashcard updated.");
  }

  function startDrugEdit() {
    if (!selectedDrug) {
      return;
    }

    setDrugEditDraft({
      drugName: selectedDrug.drugName,
      aliases: selectedDrug.aliases.join(", "),
      sections: selectedDrug.sections.map((section) => ({ ...section }))
    });
    setIsCreatingDrug(false);
    setIsEditingDrug(true);
  }

  function startDrugCreate() {
    setDrugEditDraft({
      drugName: "",
      aliases: "",
      sections: []
    });
    setIsCreatingDrug(true);
    setIsEditingDrug(true);
  }

  async function saveDrugEdit() {
    if (!activeDeck || !drugEditDraft) {
      return;
    }

    const previousDrugName = selectedDrug?.drugName ?? "";
    const updatedDrugName = drugEditDraft.drugName.trim() || previousDrugName;
    const aliases = normalizeList(drugEditDraft.aliases);
    const sections = drugEditDraft.sections
      .map((section) => ({
        ...section,
        label: section.label.trim(),
        content: section.content.trim()
      }))
      .filter((section) => section.label && section.content);

    if (!updatedDrugName || sections.length === 0) {
      setToast("Add a drug name and at least one filled section.");
      return;
    }

    if (isCreatingDrug) {
      const newDrugId = createId("drug");
      const generatedCards = buildFlashcardsFromSections(updatedDrugName, sections, aliases);
      await persistDeck((deck) => ({
        ...deck,
        flashcards: [...deck.flashcards, ...generatedCards],
        drugReferences: [
          ...deck.drugReferences,
          {
            id: newDrugId,
            drugName: updatedDrugName,
            aliases,
            sections,
            searchText: buildSearchText(updatedDrugName, aliases, sections)
          }
        ]
      }));
      setSelectedDrugId(newDrugId);
      setIsCreatingDrug(false);
      setIsEditingDrug(false);
      setDrugEditDraft(null);
      setToast("Drug added to Work Mode and Study Mode.");
      return;
    }

    if (!selectedDrug) {
      return;
    }

    await persistDeck((deck) => ({
      ...deck,
      flashcards: deck.flashcards.map((card) =>
        card.drugName === previousDrugName
          ? {
              ...card,
              drugName: updatedDrugName
            }
          : card
      ),
      drugReferences: deck.drugReferences.map((drug) =>
        drug.id === selectedDrug.id
          ? {
              ...drug,
              drugName: updatedDrugName,
              aliases,
              sections,
              searchText: buildSearchText(updatedDrugName, aliases, sections)
            }
          : drug
      )
    }));

    if (studyDrugFilter === previousDrugName) {
      setStudyDrugFilter(updatedDrugName);
    }
    setIsCreatingDrug(false);
    setIsEditingDrug(false);
    setDrugEditDraft(null);
    setToast("Work Mode details updated.");
  }

  function updateDrugSection(sectionId: string, key: "label" | "content", value: string) {
    setDrugEditDraft((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((section) =>
              section.id === sectionId
                ? {
                    ...section,
                    [key]: value
                  }
                : section
            )
          }
        : current
    );
  }

  function addDrugSection() {
    setDrugEditDraft((current) =>
      current
        ? {
            ...current,
            sections: [
              ...current.sections,
              {
                id: `section-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                label: "",
                content: ""
              }
            ]
          }
        : current
    );
  }

  function addCommonDrugSection() {
    const label = newSectionLabel.trim();
    if (!label) {
      return;
    }

    setDrugEditDraft((current) =>
      current
        ? {
            ...current,
            sections: current.sections.some(
              (section) => section.label.toLowerCase() === label.toLowerCase()
            )
              ? current.sections
              : [
                  ...current.sections,
                  {
                    id: createId("section"),
                    label,
                    content: ""
                  }
                ]
          }
        : current
    );
  }

  function removeDrugSection(sectionId: string) {
    setDrugEditDraft((current) =>
      current
        ? {
            ...current,
            sections: current.sections.filter((section) => section.id !== sectionId)
          }
        : current
    );
  }

  const masteredCount = progress?.masteredCardIds.length ?? 0;
  const missedCount = progress?.missedCardIds.length ?? 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Offline-first PWA</p>
          <h1>Study Cards</h1>
          <p className="lede">
            Build flashcards, quick-reference cards, and searchable study notes for any subject.
          </p>
        </div>

        <section className="panel">
          <div className="panel-header">
            <h2>Decks</h2>
          </div>
          <div className="deck-list">
            {decks.map((deck) => (
              <button
                key={deck.id}
                className={`deck-button ${deck.id === activeDeck?.id ? "active" : ""}`}
                onClick={() => setActiveDeckId(deck.id)}
              >
                <span>{deck.name}</span>
                <small>{deck.flashcards.length} cards, {deck.drugReferences.length} drugs</small>
              </button>
            ))}
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={backupActiveDeck}>
              Backup Active Deck
            </button>
            <button className="secondary-button" onClick={exportFlashcardsCsv}>
              Export Flashcards CSV
            </button>
            <button className="secondary-button" onClick={exportDrugReferencesCsv}>
              Export Work Mode CSV
            </button>
          </div>
          {activeDeck && activeDeck !== decks[0] ? (
            <button className="text-button danger" onClick={() => void removeDeck(activeDeck.id)}>
              Delete active deck
            </button>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Import Builder</h2>
          </div>
          <label className="field-label">
            Deck name
            <input
              value={importName}
              onChange={(event) => setImportName(event.target.value)}
              placeholder="ICU Vasoactive Drips"
            />
          </label>
          <label className="file-input">
            Import file
            <input type="file" accept=".csv,.tsv,.txt,.json" onChange={(event) => void handleFileImport(event)} />
          </label>
          <label className="field-label">
            Paste cards or drug data
            <textarea
              rows={8}
              value={importDraft}
              onChange={(event) => setImportDraft(event.target.value)}
              placeholder="drugName,front,back,indication,dose"
            />
          </label>
          <div className="button-row">
            <button className="primary-button" onClick={handleImportParse}>
              Parse Import
            </button>
            <button className="secondary-button" onClick={() => void saveImportedDeck()}>
              Save Deck
            </button>
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={() => void refreshLegacyDeck()}>
              Refresh Original Drug Sheet
            </button>
          </div>
          {parsedImport ? (
            <div className="mapping-grid">
              {parsedImport.headers.map((header, index) => (
                <label key={`${header}-${index}`} className="mapping-row">
                  <span>{header}</span>
                  <select
                    value={fieldMapping[index] ?? "ignore"}
                    onChange={(event) =>
                      setFieldMapping((current) => ({
                        ...current,
                        [index]: event.target.value as ImportFieldKey
                      }))
                    }
                  >
                    {importOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : (
            <p className="hint">
              Supports CSV, TSV, JSON, quoted CSV, blank-line card blocks, remote sheet imports, and deck backup restore.
            </p>
          )}
        </section>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Current deck</p>
            <h2>{activeDeck?.name ?? "Loading..."}</h2>
          </div>
          <div className="mode-switch">
            <button className={viewMode === "study" ? "active" : ""} onClick={() => setViewMode("study")}>
              Study Mode
            </button>
            <button className={viewMode === "work" ? "active" : ""} onClick={() => setViewMode("work")}>
              Work Mode
            </button>
          </div>
        </header>

        {viewMode === "study" ? (
          <section className="content-grid">
            <article className="panel hero-panel">
              <div className="panel-header">
                <h2>Study</h2>
                <div className="pill-row">
                  <button
                    className={studyFilter === "all" ? "pill active" : "pill"}
                    onClick={() => {
                      setStudyFilter("all");
                      setStudyDrugFilter("");
                    }}
                  >
                    All
                  </button>
                  <button
                    className={studyFilter === "missed" ? "pill active" : "pill"}
                    onClick={() => setStudyFilter("missed")}
                  >
                    Review Missed
                  </button>
                  <button
                    className={studyFilter === "mastered" ? "pill active" : "pill"}
                    onClick={() => setStudyFilter("mastered")}
                  >
                    Mastered
                  </button>
                </div>
              </div>

              {currentCard ? (
                <>
                  {isEditingCard && cardEditDraft ? (
                    <div className="editor-panel">
                      <div className="panel-header">
                        <h3>Edit Current Card</h3>
                      </div>
                      <label className="field-label">
                        Drug name
                        <input
                          value={cardEditDraft.drugName}
                          onChange={(event) =>
                            setCardEditDraft((current) =>
                              current ? { ...current, drugName: event.target.value } : current
                            )
                          }
                        />
                      </label>
                      <label className="field-label">
                        Front
                        <textarea
                          rows={3}
                          value={cardEditDraft.front}
                          onChange={(event) =>
                            setCardEditDraft((current) =>
                              current ? { ...current, front: event.target.value } : current
                            )
                          }
                        />
                      </label>
                      <label className="field-label">
                        Back
                        <textarea
                          rows={5}
                          value={cardEditDraft.back}
                          onChange={(event) =>
                            setCardEditDraft((current) =>
                              current ? { ...current, back: event.target.value } : current
                            )
                          }
                        />
                      </label>
                      <label className="field-label">
                        Category
                        <input
                          value={cardEditDraft.category}
                          onChange={(event) =>
                            setCardEditDraft((current) =>
                              current ? { ...current, category: event.target.value } : current
                            )
                          }
                        />
                      </label>
                      <label className="field-label">
                        Tags
                        <input
                          value={cardEditDraft.tags}
                          onChange={(event) =>
                            setCardEditDraft((current) =>
                              current ? { ...current, tags: event.target.value } : current
                            )
                          }
                          placeholder="pressor, shock"
                        />
                      </label>
                      <div className="button-row">
                        <button className="primary-button" onClick={() => void saveCardEdit()}>
                          Save card
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setIsEditingCard(false);
                            setCardEditDraft(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className={`flashcard ${isCardFlipped ? "flipped" : ""}`}
                      onClick={() => setIsCardFlipped((value) => !value)}
                    >
                      <div className="flashcard-face flashcard-front">
                        <span className="flashcard-label">{currentCard.drugName}</span>
                        <h3>{currentCard.front}</h3>
                        <p>Tap to reveal the answer.</p>
                      </div>
                      <div className="flashcard-face flashcard-back">
                        <span className="flashcard-label">{currentCard.category ?? "Flashcard"}</span>
                        <h3>{currentCard.back}</h3>
                      </div>
                    </button>
                  )}

                  <div className="study-footer">
                    <div className="study-progress">
                      Card {studyCards.length === 0 ? 0 : currentCardIndex + 1} of {studyCards.length}
                    </div>
                    <div className="button-row">
                      <button className="secondary-button" onClick={startCardEdit}>
                        Edit card
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setIsCardFlipped(false);
                          setCurrentCardIndex((index) => Math.max(index - 1, 0));
                        }}
                      >
                        Previous
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setIsCardFlipped(false);
                          setCurrentCardIndex((index) =>
                            Math.min(index + 1, Math.max(studyCards.length - 1, 0))
                          );
                        }}
                      >
                        Next
                      </button>
                      <button className="success-button" onClick={() => void markCard(currentCard, true)}>
                        Correct
                      </button>
                      <button className="danger-button" onClick={() => void markCard(currentCard, false)}>
                        Review
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <h3>No cards in this filter.</h3>
                  <p>Import a deck, clear the focus, or switch filters.</p>
                </div>
              )}
            </article>

            <aside className="panel stats-panel">
              <div className="panel-header">
                <h2>Progress</h2>
              </div>
              {studyDrugFilter ? (
                <div className="focus-chip-row">
                  <span className="focus-chip">Focused: {studyDrugFilter}</span>
                  <button className="text-button" onClick={() => setStudyDrugFilter("")}>
                    Clear focus
                  </button>
                </div>
              ) : null}
              <div className="stat-block">
                <strong>{activeDeck?.flashcards.length ?? 0}</strong>
                <span>Total cards</span>
              </div>
              <div className="stat-block">
                <strong>{masteredCount}</strong>
                <span>Mastered</span>
              </div>
              <div className="stat-block">
                <strong>{missedCount}</strong>
                <span>Marked for review</span>
              </div>
              <p className="hint">
                Work Mode opens drug details directly, and edits there update the same local deck.
              </p>
            </aside>
          </section>
        ) : (
          <section className="content-grid work-layout">
            <aside className="panel work-list-panel">
              <div className="panel-header">
                <h2>Search Cards</h2>
                <span className="hint">Press `/` to search</span>
              </div>
              <label className="field-label">
                Search item
                <input
                  ref={workSearchRef}
                  value={workSearch}
                  onChange={(event) => setWorkSearch(event.target.value)}
                  placeholder="Type to narrow the list"
                />
              </label>
              <div className="button-row">
                <button className="secondary-button" onClick={startDrugCreate}>
                  Add card set
                </button>
              </div>
              <label className="field-label">
                Select item
                <select
                  className="drug-select"
                  size={12}
                  value={selectedDrug?.id ?? ""}
                  onChange={(event) => void openDrug(event.target.value)}
                >
                  {alphabeticalDrugs.map((drug) => (
                    <option key={drug.id} value={drug.id}>
                      {drug.drugName}
                    </option>
                  ))}
                </select>
              </label>
              {progress && (progress.pinnedDrugIds.length > 0 || progress.recentDrugIds.length > 0) ? (
                <div className="quick-groups">
                  {progress.pinnedDrugIds.length > 0 ? (
                    <div className="quick-group">
                      <span className="group-label">Pinned</span>
                      <div className="chip-row">
                        {progress.pinnedDrugIds
                          .map((id) => activeDeck?.drugReferences.find((drug) => drug.id === id))
                          .filter((drug): drug is NonNullable<typeof drug> => Boolean(drug))
                          .map((drug) => (
                            <button key={drug.id} className="pill" onClick={() => void openDrug(drug.id)}>
                              {drug.drugName}
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  {progress.recentDrugIds.length > 0 ? (
                    <div className="quick-group">
                      <span className="group-label">Recent</span>
                      <div className="chip-row">
                        {progress.recentDrugIds
                          .map((id) => activeDeck?.drugReferences.find((drug) => drug.id === id))
                          .filter((drug): drug is NonNullable<typeof drug> => Boolean(drug))
                          .map((drug) => (
                            <button key={drug.id} className="pill" onClick={() => void openDrug(drug.id)}>
                              {drug.drugName}
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <p className="hint">
                {alphabeticalDrugs.length} items match the current filter.
              </p>
            </aside>

            <article className="panel work-detail-panel">
              {selectedDrug ? (
                <>
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">Quick reference</p>
                      <h2>{selectedDrug.drugName}</h2>
                      {selectedDrug.aliases.length > 0 ? (
                        <p className="hint">Also known as: {selectedDrug.aliases.join(", ")}</p>
                      ) : null}
                    </div>
                    <div className="button-row compact-actions">
                      <button className="secondary-button" onClick={() => focusDrugInStudy(selectedDrug.drugName)}>
                        Study this drug
                      </button>
                      <button className="secondary-button" onClick={startDrugEdit}>
                        Edit details
                      </button>
                      <button
                        className={pinnedIds.has(selectedDrug.id) ? "primary-button" : "secondary-button"}
                        onClick={() => void togglePin(selectedDrug.id)}
                      >
                        {pinnedIds.has(selectedDrug.id) ? "Unpin" : "Pin"}
                      </button>
                    </div>
                  </div>

                  <div className="summary-strip">
                    <div className="summary-metric">
                      <strong>{selectedDrug.sections.length}</strong>
                      <span>Reference sections</span>
                    </div>
                    <div className="summary-metric">
                      <strong>{selectedDrugStudyCount}</strong>
                      <span>Study cards</span>
                    </div>
                  </div>

                  {isEditingDrug && drugEditDraft ? (
                    <div className="editor-panel">
                      <div className="panel-header">
                        <h3>{isCreatingDrug ? "Add Card Set" : "Edit Card Set"}</h3>
                      </div>
                      <label className="field-label">
                        Drug name
                        <input
                          value={drugEditDraft.drugName}
                          onChange={(event) =>
                            setDrugEditDraft((current) =>
                              current ? { ...current, drugName: event.target.value } : current
                            )
                          }
                        />
                      </label>
                      <label className="field-label">
                        Aliases
                        <input
                          value={drugEditDraft.aliases}
                          onChange={(event) =>
                            setDrugEditDraft((current) =>
                              current ? { ...current, aliases: event.target.value } : current
                            )
                          }
                          placeholder="Levophed, Levo"
                        />
                      </label>
                      <div className="button-row">
                        <label className="field-label grow-field">
                          Add common section
                          <select
                            value={newSectionLabel}
                            onChange={(event) => setNewSectionLabel(event.target.value)}
                          >
                            {COMMON_SECTION_LABELS.map((label) => (
                              <option key={label} value={label}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="secondary-button" onClick={addCommonDrugSection}>
                          Add selected
                        </button>
                      </div>
                      <div className="section-editor-list">
                        {drugEditDraft.sections.map((section) => (
                          <div key={section.id} className="section-editor-card">
                            <label className="field-label">
                              Section label
                              <input
                                value={section.label}
                                onChange={(event) =>
                                  updateDrugSection(section.id, "label", event.target.value)
                                }
                              />
                            </label>
                            <label className="field-label">
                              Content
                              <textarea
                                rows={4}
                                value={section.content}
                                onChange={(event) =>
                                  updateDrugSection(section.id, "content", event.target.value)
                                }
                              />
                            </label>
                            <button
                              className="text-button danger"
                              onClick={() => removeDrugSection(section.id)}
                            >
                              Remove section
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="button-row">
                        <button className="secondary-button" onClick={addDrugSection}>
                          Add section
                        </button>
                        <button className="primary-button" onClick={() => void saveDrugEdit()}>
                          Save details
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setIsCreatingDrug(false);
                            setIsEditingDrug(false);
                            setDrugEditDraft(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="reference-grid">
                      {prioritizedSections.map((section) => (
                        <section key={section.id} className="reference-card">
                          <h3>{section.label}</h3>
                          <p>{section.content}</p>
                        </section>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <h3>No drug details found.</h3>
                  <p>Import reference fields like indication, dose, monitoring, cautions, and notes.</p>
                </div>
              )}
            </article>
          </section>
        )}
      </main>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
