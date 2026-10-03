-- SOLO DESARROLLO LOCAL. Da login al rol app_user para que la API se conecte.
-- En producción el login/contraseña se provisiona vía secret manager (§7), nunca aquí.
ALTER ROLE app_user LOGIN PASSWORD 'app_user_dev';
