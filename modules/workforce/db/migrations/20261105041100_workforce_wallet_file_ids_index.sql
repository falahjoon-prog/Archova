-- archova:no-transaction
-- Lets the files policy find the documents that list a file without scanning the wallet.
create index concurrently if not exists compliance_documents_file_ids
  on workforce.compliance_documents using gin (file_ids);
