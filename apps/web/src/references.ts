/** Freely licensed photographs of real coworking spaces, with the credit each licence requires. */
export interface Reference {
  id: string;
  src: string;
  title: string;
  credit: string;
}

export const REFERENCES: Reference[] = [
  {
    id: "neyron",
    src: "/references/work-and-wall-neyron.jpg",
    title: "Oak floors and white desks",
    credit: "Benoît Prieur, CC0, Wikimedia Commons",
  },
  {
    id: "c4di",
    src: "/references/c4di-coworking.jpg",
    title: "Glass front and moss wall",
    credit: "Influence Media, CC BY 4.0, Wikimedia Commons",
  },
  {
    id: "cubespace",
    src: "/references/cubespace-cubicles.jpg",
    title: "Cubicles",
    credit: "Asa Wilson, CC BY-SA 2.0, Wikimedia Commons",
  },
];
