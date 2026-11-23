-- El placeholder «Sin datos» no es un título de OnlyFans. La UI lo pone si falta.
update of_vault_item
set title = null
where title is not null
  and btrim(title) = 'Sin datos';
