ALTER TABLE users
ADD COLUMN name varchar(100);

ALTER TABLE users
ADD CONSTRAINT users_name_valid CHECK (
  name IS NULL OR (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 100
  )
);
