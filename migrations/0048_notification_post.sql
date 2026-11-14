-- Texto y enlace de la publicación de un comentario.
-- Null significa que esa respuesta no traía el campo.
-- 0046 ya está publicada y no se toca: un Mac con esa versión aplica esto encima.
alter table of_notification add column if not exists post_link text;
alter table of_notification add column if not exists post_text text;
