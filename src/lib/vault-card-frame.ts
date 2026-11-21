/** Marco de cada tarjeta. Va en style, no en una clase: si el aspect-ratio no entra en el CSS, la caja se queda en unos píxeles. */
export const VAULT_CARD_FRAME = {
  aspectRatio: "1 / 1",
  minHeight: "96px",
  width: "100%",
} as const;

export const VAULT_CARD_IMAGE = {
  objectFit: "cover",
  objectPosition: "center",
  width: "100%",
  height: "100%",
} as const;
