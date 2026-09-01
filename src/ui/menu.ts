/* Snabbmenyn -- en komponent, två användare (editorn och sidopanelen).
 *
 * Menyn ritas i document.body och positioneras fritt, så den kan hänga utanför
 * sin förälder utan att klippas av. Undermenyer öppnas åt höger, eller åt
 * vänster när det inte får plats. */

export type MenuItem =
  | { kind: "separator" }
  | {
      label: string;
      icon?: keyof typeof ICONS;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      run?: () => void;
      submenu?: MenuItem[];
    };

/* Enkla streckikoner i 16x16, ritade som SVG-banor. */
const ICONS = {
  link: "M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1 M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1",
  external: "M9 3h4v4 M13 3l-6 6 M11 9.5V13H3V5h3.5",
  format: "M4 13l4-9 4 9 M5.6 10h4.8",
  paragraph: "M8.5 3H12 M8.5 3v10 M11 3v10 M8.5 3a2.5 2.5 0 0 0 0 5",
  insert: "M8 3.5v9 M3.5 8h9",
  cut: "M4 3l8 9 M12 3l-8 9 M4.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M11.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  copy: "M5.5 5.5V3h7.5v7.5H10.5 M3 5.5h7.5V13H3z",
  paste: "M6 3.5h4 M5 4.5H3.5V13h9V4.5H11 M6 2.5h4v2H6z",
  selectAll: "M3 3h3 M10 3h3 M3 13h3 M10 13h3 M3 6v4 M13 6v4",
  trash: "M3.5 4.5h9 M6 4.5V3h4v1.5 M5 4.5V13h6V4.5",
  note: "M4 2h5l3 3v9H4z M9 2v3h3",
  folder: "M2.5 4.5h4l1 1.5h6v7h-11z",
  heading: "M4 13V3 M11 13V3 M4 8h7",
  quote: "M6 5.5C4.5 6 4 7 4 9v2h3V8H5.5c0-1 .5-1.5 1.5-1.8z M12 5.5c-1.5.5-2 1.5-2 3.5v2h3V8h-1.5c0-1 .5-1.5 1.5-1.8z",
  list: "M3 4.5h.01 M3 8h.01 M3 11.5h.01 M6 4.5h7 M6 8h7 M6 11.5h7",
  code: "M6 5L3 8l3 3 M10 5l3 3-3 3",
  rule: "M3 8h10",
  check: "M3.5 4.5h3v3h-3z M3.5 11l1.5 1.5 2-2.5 M9 6h4 M9 11h4",
} as const;

/* Alla öppna menyer -- huvudmenyn och dess undermenyer -- bor i ett gemensamt
   lager. Då räcker det att ta bort lagret för att stänga allt, och ett klick
   i en undermeny räknas fortfarande som ett klick "inuti" menyn. */
let layer: HTMLElement | null = null;

export function closeMenu() {
  layer?.remove();
  layer = null;
  document.removeEventListener("mousedown", onDocumentDown, true);
  document.removeEventListener("keydown", onKey, true);
}

function onDocumentDown(event: MouseEvent) {
  if (!(event.target instanceof Node) || !layer?.contains(event.target)) closeMenu();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
  }
}

function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "menu__icon");
  for (const d of ICONS[name].split(" M")) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d.startsWith("M") ? d : `M${d}`);
    svg.append(path);
  }
  return svg;
}

/** Placerar en meny så att den alltid ryms i fönstret. */
function place(menu: HTMLElement, x: number, y: number, flipFrom?: number) {
  menu.style.visibility = "hidden";
  (layer ?? document.body).append(menu);
  const box = menu.getBoundingClientRect();
  const margin = 8;

  let left = x;
  if (left + box.width > window.innerWidth - margin) {
    left = flipFrom !== undefined ? flipFrom - box.width : window.innerWidth - box.width - margin;
  }
  const top = Math.max(margin, Math.min(y, window.innerHeight - box.height - margin));

  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "";
}

function build(items: MenuItem[], depth: number): HTMLElement {
  const menu = document.createElement("div");
  menu.className = depth === 0 ? "menu" : "menu menu--sub";

  let submenu: HTMLElement | null = null;
  const closeSubmenu = () => {
    submenu?.remove();
    submenu = null;
  };

  for (const item of items) {
    if ("kind" in item) {
      const separator = document.createElement("div");
      separator.className = "menu__sep";
      menu.append(separator);
      continue;
    }

    const row = document.createElement("button");
    row.className = "menu__item";
    row.type = "button";
    if (item.disabled) row.classList.add("is-disabled");
    if (item.danger) row.classList.add("is-danger");

    if (item.icon) row.append(icon(item.icon));
    else row.append(Object.assign(document.createElement("span"), { className: "menu__icon" }));

    const label = document.createElement("span");
    label.className = "menu__label";
    label.textContent = item.label;
    row.append(label);

    if (item.shortcut) {
      const hint = document.createElement("span");
      hint.className = "menu__shortcut";
      hint.textContent = item.shortcut;
      row.append(hint);
    }
    if (item.submenu) {
      const arrow = document.createElement("span");
      arrow.className = "menu__arrow";
      arrow.textContent = "›";
      row.append(arrow);
    }

    row.addEventListener("mouseenter", () => {
      closeSubmenu();
      if (item.disabled || !item.submenu) return;

      submenu = build(item.submenu, depth + 1);
      const box = row.getBoundingClientRect();
      // Undermenyn överlappar föräldern med några pixlar så att musen inte
      // tappar den på vägen dit.
      place(submenu, box.right - 4, box.top - 5, box.left + 4);
    });

    if (!item.disabled && item.run) {
      row.addEventListener("click", () => {
        const action = item.run!;
        closeMenu();
        action();
      });
    }

    menu.append(row);
  }

  menu.addEventListener("mouseleave", (event) => {
    // Behåll undermenyn om musen är på väg in i den.
    if (submenu && event.relatedTarget instanceof Node && submenu.contains(event.relatedTarget)) return;
    closeSubmenu();
  });

  return menu;
}

export function showMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  layer = document.createElement("div");
  layer.className = "menu-layer";
  document.body.append(layer);

  place(build(items, 0), x, y);

  // I capture-fasen, så att menyn stängs innan något annat hinner reagera.
  document.addEventListener("mousedown", onDocumentDown, true);
  document.addEventListener("keydown", onKey, true);
}
