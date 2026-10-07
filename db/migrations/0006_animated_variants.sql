-- =====================================================================
--  Statico e animato, entrambi.
--
--  Certe carte (quasi tutte le LR) hanno artwork e miniatura animati.
--  Non sono la stessa immagine in due formati: sono due contenuti, e
--  costano in modo molto diverso.
--
--    miniatura animata  ~35 KB    — trascurabile, si puo' mostrare sempre
--    artwork animato    ~9 MB     — 650 fotogrammi a 356x474. Ricodificarlo
--                                   non serve: il peso sono i fotogrammi,
--                                   non la risoluzione. Va scelto.
--
--  Quindi si tengono tutte e due le versioni e sceglie chi guarda: una
--  preferenza nel profilo per il comportamento di base, e un interruttore
--  sulla pagina della carta per la singola carta (quello e' stato
--  dell'interfaccia, non ha bisogno di schema).
-- =====================================================================

alter type asset_kind add value if not exists 'card_thumb_animated';
alter type asset_kind add value if not exists 'card_art_animated';

alter table card add column thumb_animated_key text references asset(key) on delete set null;
alter table card add column art_animated_key   text references asset(key) on delete set null;

-- La preferenza di base dell'utente. Falso = si mostra il fotogramma
-- statico, che e' la scelta gentile: l'artwork animato e' 200 volte piu'
-- pesante e su una connessione mobile si sente.
alter table app_user add column prefers_animated boolean not null default false;
