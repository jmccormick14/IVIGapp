import type {
  Deck,
  DrugReference,
  DrugReferenceSection,
  Flashcard,
  ImportFieldKey,
  ParsedImport
} from "../types";
import { createId } from "./ids";

const referenceLabels: Record<
  Exclude<
    ImportFieldKey,
    "drugName" | "front" | "back" | "type" | "category" | "tags" | "aliases" | "ignore"
  >,
  string
> = {
  indication: "Indication",
  dose: "Dose",
  concentration: "Concentration",
  preparation: "Preparation",
  administration: "Administration",
  monitoring: "Monitoring",
  cautions: "Cautions",
  notes: "Notes"
};

function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("\t")) {
    return "\t";
  }

  if (firstLine.includes("|")) {
    return "|";
  }

  return ",";
}

function parseDelimited(content: string, delimiter: string): ParsedImport {
  const rows = parseDelimitedRows(content, delimiter)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (rows.length === 0) {
    throw new Error("No rows found in the imported content.");
  }

  const [headers, ...dataRows] = rows;

  return {
    headers,
    rows: dataRows,
    suggestedName: "Imported Deck"
  };
}

function parseDelimitedRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function parseJson(content: string): ParsedImport {
  const parsed = JSON.parse(content) as Record<string, unknown>[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("JSON import must contain a non-empty array of records.");
  }

  const headers = Array.from(
    parsed.reduce<Set<string>>((all, row) => {
      Object.keys(row).forEach((key) => all.add(key));
      return all;
    }, new Set<string>())
  );

  const rows = parsed.map((row) =>
    headers.map((header) => {
      const value = row[header];
      return typeof value === "string" ? value : JSON.stringify(value ?? "");
    })
  );

  return {
    headers,
    rows,
    suggestedName: "Imported JSON Deck"
  };
}

export function parseImportText(content: string, fileName?: string): ParsedImport {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Import content is empty.");
  }

  const parsed = trimmed.startsWith("[")
    ? parseJson(trimmed)
    : looksLikePlainBlocks(trimmed)
      ? parsePlainBlocks(trimmed)
      : parseDelimited(trimmed, detectDelimiter(trimmed));

  if (fileName) {
    parsed.suggestedName = fileName.replace(/\.[^.]+$/, "");
  }

  return parsed;
}

function looksLikePlainBlocks(content: string): boolean {
  if (content.includes(",") || content.includes("\t") || content.includes("|")) {
    return false;
  }

  return /\n\s*\n/.test(content);
}

function parsePlainBlocks(content: string): ParsedImport {
  const blocks = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    throw new Error("No card blocks found in pasted text.");
  }

  const rows = blocks.map((block) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const maybeDrug = lines[0]?.match(/^drug\s*:\s*(.+)$/i)?.[1] ?? "";
    const contentStart = maybeDrug ? 1 : 0;
    const front = lines[contentStart] ?? "";
    const back = lines.slice(contentStart + 1).join("\n");

    return [maybeDrug, front, back];
  });

  return {
    headers: ["drugName", "front", "back"],
    rows,
    suggestedName: "Pasted Deck"
  };
}

function normalizeListValue(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildReferenceSections(row: Record<ImportFieldKey, string>): DrugReferenceSection[] {
  return Object.entries(referenceLabels)
    .map(([key, label]) => ({
      id: createId("section"),
      label,
      content: row[key as keyof typeof referenceLabels]
    }))
    .filter((section) => section.content);
}

function buildLegacySummarySections(row: Record<ImportFieldKey, string>): DrugReferenceSection[] {
  const summaryLabel = row.front?.trim() || "Summary";
  const summaryContent = row.back?.trim();

  if (!summaryContent) {
    return [];
  }

  return [
    {
      id: createId("section"),
      label: summaryLabel,
      content: summaryContent
    }
  ];
}

export function buildDeckFromImport(
  deckName: string,
  parsedImport: ParsedImport,
  fieldMapping: Record<number, ImportFieldKey>
): Deck {
  const now = new Date().toISOString();
  const flashcards: Flashcard[] = [];
  const referencesByDrug = new Map<string, DrugReference>();

  parsedImport.rows.forEach((cells, rowIndex) => {
    const mappedRow = Object.entries(fieldMapping).reduce<Record<ImportFieldKey, string>>(
      (result, [columnIndex, key]) => {
        result[key] = cells[Number(columnIndex)]?.trim() ?? "";
        return result;
      },
      {
        drugName: "",
        front: "",
        back: "",
        type: "",
        category: "",
        tags: "",
        aliases: "",
        indication: "",
        dose: "",
        concentration: "",
        preparation: "",
        administration: "",
        monitoring: "",
        cautions: "",
        notes: "",
        ignore: ""
      }
    );

    const drugName = mappedRow.drugName || "Unnamed Drug";
    const rowType = mappedRow.type.toLowerCase();
    const isSummaryRow = rowType.includes("summary");
    const referenceSections = isSummaryRow
      ? buildLegacySummarySections(mappedRow)
      : buildReferenceSections(mappedRow);

    if (mappedRow.front && mappedRow.back && !isSummaryRow) {
      flashcards.push({
        id: createId("card"),
        drugName,
        front: mappedRow.front,
        back: mappedRow.back,
        category: mappedRow.category || undefined,
        tags: normalizeListValue(mappedRow.tags),
        sourceRow: rowIndex + 1
      });
    }

    if (referenceSections.length > 0 || mappedRow.aliases) {
      const existing = referencesByDrug.get(drugName);
      const mergedSections = existing
        ? mergeSections(existing.sections, referenceSections)
        : referenceSections;
      const aliases = [
        ...(existing?.aliases ?? []),
        ...normalizeListValue(mappedRow.aliases)
      ].filter((value, index, array) => array.indexOf(value) === index);

      referencesByDrug.set(drugName, {
        id: existing?.id ?? createId("drug"),
        drugName,
        aliases,
        sections: mergedSections,
        searchText: [drugName, ...aliases, ...mergedSections.map((section) => section.content)]
          .join(" ")
          .toLowerCase()
      });
    }
  });

  return {
    id: createId("deck"),
    name: deckName || parsedImport.suggestedName,
    createdAt: now,
    updatedAt: now,
    flashcards,
    drugReferences: Array.from(referencesByDrug.values())
  };
}

function mergeSections(
  existingSections: DrugReferenceSection[],
  incomingSections: DrugReferenceSection[]
): DrugReferenceSection[] {
  const byLabel = new Map(existingSections.map((section) => [section.label, section]));

  incomingSections.forEach((section) => {
    const current = byLabel.get(section.label);
    if (!current) {
      byLabel.set(section.label, section);
      return;
    }

    if (!current.content.includes(section.content)) {
      current.content = `${current.content}\n\n${section.content}`.trim();
    }
  });

  return Array.from(byLabel.values());
}

export function suggestFieldMapping(headers: string[]): Record<number, ImportFieldKey> {
  return headers.reduce<Record<number, ImportFieldKey>>((mapping, header, index) => {
    const normalized = header.toLowerCase();

    if (/(drug|medication|name)/.test(normalized)) {
      mapping[index] = "drugName";
    } else if (/(front|question|prompt)/.test(normalized)) {
      mapping[index] = "front";
    } else if (/(back|answer|response)/.test(normalized)) {
      mapping[index] = "back";
    } else if (/(type|kind|format)/.test(normalized)) {
      mapping[index] = "type";
    } else if (/categor/.test(normalized)) {
      mapping[index] = "category";
    } else if (/tag/.test(normalized)) {
      mapping[index] = "tags";
    } else if (/alias|brand/.test(normalized)) {
      mapping[index] = "aliases";
    } else if (/indic/.test(normalized)) {
      mapping[index] = "indication";
    } else if (/dose|rate/.test(normalized)) {
      mapping[index] = "dose";
    } else if (/concentration/.test(normalized)) {
      mapping[index] = "concentration";
    } else if (/prep|mix|dilution/.test(normalized)) {
      mapping[index] = "preparation";
    } else if (/admin|line|filter|tubing/.test(normalized)) {
      mapping[index] = "administration";
    } else if (/monitor/.test(normalized)) {
      mapping[index] = "monitoring";
    } else if (/caution|warning|contra/.test(normalized)) {
      mapping[index] = "cautions";
    } else if (/note|summary/.test(normalized)) {
      mapping[index] = "notes";
    } else {
      mapping[index] = "ignore";
    }

    return mapping;
  }, {});
}
