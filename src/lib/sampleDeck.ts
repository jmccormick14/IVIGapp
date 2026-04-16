import type { Deck } from "../types";
import { createId } from "./ids";

function referenceSection(label: string, content: string) {
  return {
    id: createId("section"),
    label,
    content
  };
}

export const sampleDeck: Deck = {
  id: createId("deck"),
  name: "Sample Drug Starter Deck",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  flashcards: [
    {
      id: createId("card"),
      drugName: "Norepinephrine",
      front: "Norepinephrine: primary clinical use?",
      back: "Vasopressor commonly used for septic shock to support MAP.",
      category: "Vasoactive",
      tags: ["pressor", "shock"],
      sourceRow: 1
    },
    {
      id: createId("card"),
      drugName: "Amiodarone",
      front: "Amiodarone: key rhythm indication?",
      back: "Used in certain atrial and ventricular dysrhythmias.",
      category: "Antiarrhythmic",
      tags: ["rhythm", "cardiac"],
      sourceRow: 2
    }
  ],
  drugReferences: [
    {
      id: createId("drug"),
      drugName: "Norepinephrine",
      aliases: ["Levophed"],
      searchText: "norepinephrine levophed vasopressor septic shock",
      sections: [
        referenceSection("Indication", "Shock states needing blood pressure support."),
        referenceSection("Dose", "Use your facility protocol and titrate to target MAP."),
        referenceSection("Concentration", "Store local standard concentration here."),
        referenceSection("Preparation", "Add unit-specific preparation instructions."),
        referenceSection("Administration", "Central line preferred when required by protocol."),
        referenceSection("Monitoring", "BP, MAP, perfusion, IV site, rhythm."),
        referenceSection("Cautions", "Extravasation risk. Follow local policy."),
        referenceSection("Notes", "Customize this section with unit workflow notes.")
      ]
    },
    {
      id: createId("drug"),
      drugName: "Amiodarone",
      aliases: [],
      searchText: "amiodarone antiarrhythmic",
      sections: [
        referenceSection("Indication", "Dysrhythmia management per protocol."),
        referenceSection("Dose", "Document your standard loading and maintenance details."),
        referenceSection("Monitoring", "Rhythm, BP, QT concerns, compatibility."),
        referenceSection("Notes", "Use this as a quick pre-shift refresher.")
      ]
    }
  ]
};
