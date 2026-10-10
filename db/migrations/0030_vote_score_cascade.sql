-- =====================================================================
--  Il punteggio dei voti dentro le cascate di piu' utenti.
--
--  clear_vote_sync e tip_vote_sync (0001) ricalcolano clear_version.score
--  e tip.score a ogni voto tolto. Cancellare un utente alla volta
--  (delete_account) funziona; cancellarne piu' d'uno nella stessa
--  istruzione, se hanno votato l'uno i clear o le tip dell'altro, falliva:
--
--    insert or update on table "clear_version" violates foreign key
--    constraint "clear_version_clear_id_fkey"
--
--  Perche': le cascate delle FK sono trigger AFTER, e quelli che fanno
--  partire (le cascate dei figli, clear_vote_sync) vanno in coda allo
--  stesso giro, uno dopo l'altro, non annidati. Con l'autore A e due
--  votanti B e C cancellati insieme la coda puo' essere:
--    voto di B tolto, voto di C tolto, clear di A tolto (la sua versione
--    resta in coda), sync per B, sync per C, versione di A tolta.
--  Il sync di B aggiorna la versione di un clear che non c'e' piu': passa,
--  perche' una UPDATE che non cambia clear_id non ricontrolla la FK. Ma
--  la riga ora e' stata scritta da questa transazione, e per una riga
--  cosi' Postgres ricontrolla la FK a ogni UPDATE: il sync di C la trova
--  orfana e l'istruzione intera si annulla.
--
--  Le tip non ci cascano: la tip e' figlia diretta dell'utente, quindi la
--  cascata dell'autore la toglie prima di qualsiasi tip_vote_sync, che
--  poi non trova piu' righe da aggiornare. La versione invece e' nipote
--  (utente -> clear -> versione) e resta viva un giro in piu'. Lo prova
--  la suite dei settings, su clear e tip insieme.
--
--  La correzione: il ricalcolo salta una versione il cui clear (o il suo
--  autore) non esiste piu'. La cancellazione dell'utente e' gia' avvenuta
--  quando i trigger AFTER girano, e ogni istruzione di una funzione
--  volatile la vede. Una riga
--  saltata e' gia' in coda per essere cancellata: nessun punteggio che
--  resta viene perso. Per i voti normali e per delete_account non cambia
--  niente: clear e autore ci sono, l'UPDATE e' la stessa di prima.
--
--  create or replace tiene proprietario e permessi (revocati da harden).
-- =====================================================================

create or replace function clear_recalc_score(p_version uuid)
returns void language sql as $fn$
  update clear_version v set score = (
    select coalesce(sum(value), 0) from clear_vote where version_id = p_version
  )
   where v.id = p_version
     and exists (select 1 from clear c join app_user u on u.id = c.author_id
                  where c.id = v.clear_id);
$fn$;
