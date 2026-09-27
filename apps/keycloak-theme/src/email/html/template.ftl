<#--
  Adili frame for every HTML email Keycloak sends (activation, password reset, verification...).
  Table layout with inline styles so that it renders the same in Outlook, Gmail and Apple Mail.
  Colours are the light theme tokens of packages/ui (primary #07602f, foreground #0e1913,
  muted foreground #525e57, border #dee3de, muted #f1f5f1).
-->
<#macro emailLayout preheader="">
<!DOCTYPE html>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${realmName}</title>
<style>
  body { margin: 0; padding: 0; }
  .content p { margin: 0 0 16px; }
  .content a { color: #07602f; }
  @media (max-width: 600px) {
    .card { padding: 28px 22px !important; }
    .detail-label { display: block !important; width: auto !important; padding: 8px 0 0 !important; }
    tr:first-child > .detail-label { padding-top: 0 !important; }
    .detail-value { display: block !important; padding: 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f1;">
<#if preheader?has_content>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f1;opacity:0;">${preheader}</div>
</#if>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f1;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:10px;">
                  <img src="${url.resourcesUrl}/img/logo.png" width="28" height="28" alt="" style="display:block;border:0;">
                </td>
                <td style="vertical-align:middle;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;font-weight:600;color:#0e1913;letter-spacing:-0.01em;">
                  ${realmName}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="card content" style="background-color:#ffffff;border:1px solid #dee3de;border-radius:12px;padding:36px 40px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#0e1913;">
            <#nested>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#525e57;">
            ${msg("adiliEmailFooter")}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
</#macro>
