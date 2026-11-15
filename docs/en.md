# Meteobridge

Unofficial integration, not affiliated with smartbedded (Meteobridge).

It reads the weather station connected to your **Meteobridge** gateway (NANO SD,
PRO, PRO2, NANO, or the software version: Davis, Ecowitt, Fine Offset, WeatherFlow
and the other stations it supports) directly on your local network, without
the cloud.

**This integration has never been tested with a real Meteobridge**: it was
built from the official wiki of Meteobridge (pages "Add-On Services" and
"Templates"). Feedback is welcome on the GitHub repository.

## What you get

One Gladys device per gateway (identified by its MAC address), with a
feature for each value the gateway gave at least once:

- outdoor temperature, humidity and dew point; wind chill;
- indoor temperature and humidity (console);
- pressure at sea level and at the station (hPa);
- average wind speed and gust (km/h), wind direction (degrees);
- rain rate (mm/h) and rain of the day since midnight (mm, time of the gateway);
- UV index, solar radiation (shown in lux: 1 W/m² ≈ 126.6 lx, the core has no
  W/m² unit);
- PM2.5 (µg/m³);
- the extra temperature and humidity sensors 1 to 8;
- low batteries (outdoor sensor, anemometer, rain gauge, console).

Davis soil and leaf stations are not read in this version.

## Configuration

1. In the web interface of your Meteobridge, note its IP address. Give it a
   fixed address in your router.
2. In Gladys, open the integration and enter:
   - the **address** (for example `192.168.1.50`, or `192.168.1.50:8080` if
     the web interface is not on port 80);
   - the **user name** and the **password** of the Meteobridge web interface
     (the user name is often `meteobridge`);
   - the **read interval** in minutes (1 by default, 1 to 60).
3. Click **Test the Meteobridge**, then add the device from the Discovery tab.

## How it works

Every interval, the integration sends **one** request to the template page of
the gateway (`/cgi-bin/template.cgi`), with a template that asks the current
value of each sensor. Nothing reads sooner than the interval: not the test
button, not a restart, not a reconnection (the time of the last request is
kept in `/data`, written before each request). The one exception: new
credentials or a new address, saved in the configuration, are tried within 15
seconds.

- A sensor the gateway has not heard for its hold time is written `--` by the
  gateway: the value stays unknown in Gladys, it is never published as 0. A
  text, an empty value or a value out of bounds is left out too.
- The rain of the day is published only while the rain gauge itself is current.
- A reading is published for twice the interval (5 minutes at least, 2 hours
  at most); past it, nothing old is sent again.
- Another gateway answering at the same address (another MAC address) becomes
  its own device; the values of the first one are never given to it.

## Password and security

The password is kept by Gladys in its database and never shown again. It is
sent only to the Meteobridge, in the HTTP Basic authentication of each request.
The gateway speaks plain HTTP: on your local network, the password travels
like it does when you open the web interface in your browser. Never expose the
gateway to the Internet. The password is never written in a log, a status nor
in `/data`; a redirection is never followed.

If the gateway refuses the user name or the password (HTTP 401), the
integration stops: it never sends them again by itself. Correct them and save
(they are then tried within 15 seconds), or click **Test the Meteobridge**
(one try per interval). After a restart, `/data` keeps only 8 bits of a
salted fingerprint of the refused credentials, enough not to send the same ones
again; with 1 chance in 256, new credentials match those 8 bits and wait for a
click on Test. A 403 is not a refusal of the password (something between Gladys
and the gateway): the reads go on.

A busy gateway (HTTP 429 or 5xx) gets a pause: the time it asks
(`Retry-After`), else 1 minute doubling, 30 minutes at most, kept across a
restart.

## Read only

The integration never changes anything on the gateway: it reads one page, with
the GET method only.

## Sources

The template syntax, the sensor names and the units are those of the official
Meteobridge wiki: https://www.meteobridge.com/wiki/index.php/Templates and
https://www.meteobridge.com/wiki/index.php/Add-On_Services. No code was copied.
