// Tiny helpers: $ finds an element, E creates one.
const $ = (s) => document.querySelector(s),
  E = (t, h) => {
    const e = document.createElement(t);
    e.innerHTML = h || "";
    return e;
  };
