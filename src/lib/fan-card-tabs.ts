/** Pestañas de la ficha del fan en el chat. El orden es el de la barra inferior. */
export const FAN_CARD_TABS = ["Insights", "Ventas", "Notas"] as const;

export type FanCardTab = (typeof FAN_CARD_TABS)[number];
