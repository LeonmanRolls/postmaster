// A change to an imported object.
import { registry } from "./registry.ts";
export function register(name: string): void {
  registry.push(name);
  registry.last = name;
}
