-- scheduling: prefabricated units can be tied to programme activities, next to RFIs and submittals. The target is held
-- by its id only; the prefab module decides what a caller may see. The old check is replaced, not edited.

alter table scheduling.activity_links drop constraint activity_links_kind_check;
alter table scheduling.activity_links
  add constraint activity_links_kind_check check (kind in ('rfi', 'submittal', 'prefab_unit'));
