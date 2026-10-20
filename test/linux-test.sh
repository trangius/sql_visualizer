#!/bin/bash
# Runs test/sql-check.js on the five databases test/linux-setup.sh installed.
# Any arguments go to it (a part of a schema's name, to check just those).
cd "$(dirname "$0")/.."
SQLCMDPASSWORD=$(cat ~/.sqlviz-sa) MYSQL_USER=$USER MYSQL8=/opt/mysql/bin/mysql MYSQL8_SOCKET=/run/mysql84/mysqld.sock \
  exec node test/sql-check.js "$@"
