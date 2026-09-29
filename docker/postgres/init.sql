-- Runs once when the dev Postgres volume is first created.
-- The app connects as msb_owner: owns its databases, can create roles
-- (for app_tenant), but is NOT a superuser, just like Neon's default role.
CREATE ROLE msb_owner LOGIN CREATEROLE PASSWORD 'msb_owner';
CREATE DATABASE msb_dev OWNER msb_owner;
CREATE DATABASE msb_test OWNER msb_owner;
