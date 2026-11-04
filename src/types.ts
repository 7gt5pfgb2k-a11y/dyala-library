export type Role = "admin" | "reader";
export type Me = { id: number; username: string; name: string; role: Role };
export type Progress = { lastPage: number; bookmarks: number[]; status: "not_started" | "reading" | "done"; percent: number; updatedAt: number };
export type Book = {
  id: string; ownerId: number; title: string; author: string; description: string; category: string; shelf: string;
  pages: number; color: string; note: string; hasPdf: boolean; hasCover: boolean; pdfSize: number; createdAt: number; progress: Progress;
};
export type Library = { books: Book[]; shelves: string[] };
export type Stats = {
  totalSeconds: number; todaySeconds: number; streak: number; completedBooks: number; goalMinutes: number;
  last7: { day: string; seconds: number }[];
};
