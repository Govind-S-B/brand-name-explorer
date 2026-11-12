/** Keep ordinary feeds untouched; recycle 100-row blocks for long searches. */
export class Feed {
  domains: string[] = [];
  private known = new Set<string>();
  private blocks: {
    host: HTMLLIElement;
    list?: HTMLUListElement;
    height: number;
    visible: boolean;
  }[] = [];
  private observer: IntersectionObserver;
  private frame = 0;
  constructor(
    private root: HTMLElement,
    private card: (domain: string) => HTMLLIElement,
    private changed: () => void,
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const b =
            this.blocks[Number((e.target as HTMLElement).dataset.block)];
          if (!b) continue;
          b.visible = e.isIntersecting;
        }
        this.schedule();
      },
      { rootMargin: "1000px 0px" },
    );
    addEventListener("focusout", () => this.schedule());
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || !this.blocks.length) return;
      const target = event.target as HTMLElement,
        card = target.closest<HTMLElement>("[data-domain]");
      if (!card) return;
      const index = this.domains.indexOf(card.dataset.domain!);
      const next =
        event.shiftKey && target.classList.contains("name-open")
          ? index - 1
          : !event.shiftKey && target.classList.contains("save-name")
            ? index + 1
            : -1;
      if (
        next < 0 ||
        next >= this.length ||
        root.querySelector('[data-domain="' + this.domains[next] + '"]')
      )
        return;
      event.preventDefault();
      this.blocks[Math.floor(next / 100)].visible = true;
      this.flush();
      root
        .querySelector<HTMLElement>(
          '[data-domain="' +
            this.domains[next] +
            '"] ' +
            (event.shiftKey ? ".save-name" : ".name-open"),
        )
        ?.focus();
    });
  }
  get length() {
    return this.domains.length;
  }
  truncate(length: number) {
    this.domains.length = length;
    this.known = new Set(this.domains);
    this.observer.disconnect();
    this.blocks = [];
    this.root.replaceChildren();
    this.schedule();
  }
  add(domain: string) {
    if (!this.known.has(domain)) {
      this.known.add(domain);
      this.domains.push(domain);
    }
    this.schedule();
  }
  update(domain: string) {
    const old = this.root.querySelector(`[data-domain="${domain}"]`);
    if (old) old.replaceWith(this.card(domain));
    this.add(domain);
  }
  private schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.paint();
      });
  }
  flush() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.paint();
  }
  private paint() {
    this.root.dataset.count = String(this.length);
    if (this.length <= 200) {
      while (this.root.children.length < this.length)
        this.root.append(this.card(this.domains[this.root.children.length]));
      this.changed();
      return;
    }
    if (!this.blocks.length) this.root.replaceChildren();
    const size = 100,
      count = Math.ceil(this.length / size);
    for (let i = this.blocks.length; i < count; i++) {
      const host = document.createElement("li");
      host.dataset.block = String(i);
      host.style.listStyle = "none";
      const b = { host, height: 0, visible: i === 0 };
      this.blocks.push(b);
      this.root.append(host);
      this.observer.observe(host);
    }
    this.blocks.forEach((b, i) => {
      const start = i * size,
        stop = Math.min(start + size, this.length),
        n = stop - start;
      if (b.visible || b.host.contains(document.activeElement)) {
        b.host.removeAttribute("aria-hidden");
        if (!b.list) {
          b.list = document.createElement("ul");
          b.list.className = "feed";
          b.list.setAttribute("aria-label", `Names ${start + 1} to ${stop}`);
          b.host.style.height = "";
          b.host.append(b.list);
        }
        while (b.list.children.length < n) {
          const index = start + b.list.children.length,
            card = this.card(this.domains[index]);
          card.setAttribute("aria-posinset", String(index + 1));
          card.setAttribute("aria-setsize", String(this.length));
          b.list.append(card);
        }
        b.height = b.host.getBoundingClientRect().height;
      } else {
        if (b.list) {
          b.height = b.host.getBoundingClientRect().height;
          b.list.remove();
          b.list = undefined;
        }
        b.host.setAttribute("aria-hidden", "true");
        b.host.style.height = `${b.height || n * 75}px`;
      }
    });
    this.changed();
  }
}
