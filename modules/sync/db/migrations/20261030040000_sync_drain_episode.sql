-- sync (phase 1): a drain grant belongs to one episode of someone's access (X38). Rotations count within the
-- episode, and a grant stops working once the person has been added back.

alter table sync.drain_grants add column access_episode int not null default 1;
