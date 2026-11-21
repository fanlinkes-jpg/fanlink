/** Marco de cada tarjeta. Va en style, no en una clase: si el aspect-ratio no entra en el CSS, la caja se queda en unos píxeles. */
/** Va en el botón, que es el ítem de la cuadrícula. Si el marco está en un hijo y el botón tiene overflow hidden, el botón se queda en la altura del texto suelto. */
export const VAULT_CARD_FRAME = {
  position: "relative" as const,
  display: "block" as const,
  aspectRatio: "1 / 1",
  minHeight: "95px",
  width: "100%",
  overflow: "hidden" as const,
};

export const VAULT_CARD_IMAGE = {
  position: "absolute" as const,
  inset: "0",
  objectFit: "cover" as const,
  objectPosition: "center" as const,
  width: "100%",
  height: "100%",
};
