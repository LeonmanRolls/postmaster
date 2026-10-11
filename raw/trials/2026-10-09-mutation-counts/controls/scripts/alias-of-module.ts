// A local that is another name for a module-level collection.
const names: string[] = ["b", "a"];
export function sortedNames(): string[] {
  const view = names;
  view.sort();
  return view;
}
