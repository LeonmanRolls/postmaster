// A method changes its receiver; a constructor builds it.
export class Bag {
  items: number[];
  constructor() {
    this.items = [];
  }
  add(x: number): void {
    this.items.push(x);
  }
}
