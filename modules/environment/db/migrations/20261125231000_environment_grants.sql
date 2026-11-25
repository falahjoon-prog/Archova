-- environment: the schema was created without granting the application role access, so every query
-- from app_rw failed with "permission denied for schema environment" (42501). Grant it like other modules.

select kernel.grant_module_schema('environment');
