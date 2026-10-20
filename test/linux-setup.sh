#!/bin/bash
# Installs the five databases test/sql-check.js runs its scripts on, on Ubuntu 24.04.
# SQL Server needs an x86_64 machine (an emulated one will do) and 2 GB of memory.
#
#     sudo bash test/linux-setup.sh        # once
#     bash test/linux-test.sh              # then, any number of times
#
# The user who ran sudo logs in to MariaDB and Postgres by name, without a password.
# SQL Server's sa password is made up here and kept in ~/.sqlviz-sa for that user.
set -euxo pipefail

who=${SUDO_USER:-$USER}
home=$(getent passwd "$who" | cut -d: -f6)
export DEBIAN_FRONTEND=noninteractive
apt() { command apt-get -o DPkg::Lock::Timeout=900 "$@"; }

apt update
apt install -y postgresql mariadb-server sqlite3 nodejs curl gnupg xz-utils libaio1t64 libnuma1

mariadb -e "CREATE USER IF NOT EXISTS '$who'@'localhost' IDENTIFIED VIA unix_socket; GRANT ALL ON *.* TO '$who'@'localhost';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$who'" | grep -q 1 || sudo -u postgres createuser -s "$who"

# MySQL 8.4 beside MariaDB (apt has one or the other): Oracle's build in /opt/mysql, on its own socket
# --no-defaults: not MariaDB's /etc/mysql/my.cnf
mysql_tar=mysql-8.4.13-linux-glibc2.28-x86_64-minimal.tar.xz
if [ ! -x /opt/mysql/bin/mysqld ]; then
  curl -fsSL "https://cdn.mysql.com/Downloads/MySQL-8.4/$mysql_tar" -o "/tmp/$mysql_tar" ||
    curl -fsSL "https://downloads.mysql.com/archives/get/p/23/file/$mysql_tar" -o "/tmp/$mysql_tar"
  mkdir -p /opt/mysql
  tar -xJf "/tmp/$mysql_tar" -C /opt/mysql --strip-components=1
  ln -sf /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1 # the name it was built against
fi
id mysql >/dev/null 2>&1 || useradd -r -s /bin/false mysql
if [ ! -e /var/lib/mysql84-ready ]; then # a failed start leaves a data directory that won't work
  systemctl stop mysql84 2>/dev/null || true
  rm -rf /var/lib/mysql84 && install -d -o mysql /var/lib/mysql84
  /opt/mysql/bin/mysqld --no-defaults --initialize-insecure --user=mysql --datadir=/var/lib/mysql84
  touch /var/lib/mysql84-ready
fi
cat > /etc/systemd/system/mysql84.service <<'UNIT'
[Unit]
Description=MySQL 8.4 (for the SQL visualizer's tests)
After=network.target
[Service]
User=mysql
RuntimeDirectory=mysql84
ExecStart=/opt/mysql/bin/mysqld --no-defaults --datadir=/var/lib/mysql84 --socket=/run/mysql84/mysqld.sock --port=3307 --mysqlx=OFF --pid-file=/run/mysql84/mysqld.pid
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now mysql84

# SQL Server 2025 and sqlcmd, from Microsoft
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor --yes -o /usr/share/keyrings/microsoft-prod.gpg
curl -fsSL https://packages.microsoft.com/config/ubuntu/24.04/mssql-server-2025.list > /etc/apt/sources.list.d/mssql-server-2025.list
curl -fsSL https://packages.microsoft.com/config/ubuntu/24.04/prod.list > /etc/apt/sources.list.d/microsoft-prod.list
apt update
ACCEPT_EULA=Y apt install -y mssql-server mssql-tools18 unixodbc-dev

if [ ! -s "$home/.sqlviz-sa" ]; then
  # letters, digits and a symbol: SQL Server refuses simpler ones
  echo "Sv-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')9" > "$home/.sqlviz-sa"
  chown "$who" "$home/.sqlviz-sa"
  chmod 600 "$home/.sqlviz-sa"
fi
if ! systemctl is-active --quiet mssql-server; then
  MSSQL_SA_PASSWORD=$(cat "$home/.sqlviz-sa") MSSQL_PID=Developer /opt/mssql/bin/mssql-conf -n setup accept-eula
fi
systemctl enable --now mssql-server
