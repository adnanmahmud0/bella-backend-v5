-- Create the bella_user with proper permissions
CREATE USER bella_user WITH PASSWORD 'bella_password';
GRANT ALL PRIVILEGES ON DATABASE bella_db TO bella_user;
GRANT ALL ON SCHEMA public TO bella_user;
ALTER USER bella_user CREATEDB;