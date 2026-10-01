<#--
  What the execute-actions email says, shared by the HTML and text variants. Returns plain
  strings only (no captured markup), so each variant escapes them for its own format.
-->
<#function details>
  <#local attributes = (user.attributes)!{}>
  <#local commission = (attributes.commissionName)!"">
  <#local roleCode = (attributes.invitedRole)!"">
  <#local roleTitle = message("adiliRoleTitle." + roleCode, roleCode?replace("-", " "))>
  <#local invited = commission?has_content && roleCode?has_content>
  <#local actions = requiredActions![]>
  <#local steps = []>
  <#-- Listed in the order Keycloak runs them: the link verifies the email, then OTP, then password. -->
  <#list ["VERIFY_EMAIL", "CONFIGURE_TOTP", "UPDATE_PASSWORD"] as action>
    <#if actions?seq_contains(action)>
      <#local steps += [{ "title": msg("adiliStep." + action), "detail": msg("adiliStep." + action + ".detail") }]>
    </#if>
  </#list>
  <#list actions as action>
    <#if !["VERIFY_EMAIL", "CONFIGURE_TOTP", "UPDATE_PASSWORD"]?seq_contains(action)>
      <#local steps += [{ "title": msg("requiredAction." + action), "detail": "" }]>
    </#if>
  </#list>
  <#local hours = (linkExpiration % 60 == 0)?then(linkExpiration / 60, 0)>
  <#local expiry = (hours > 1)?then(msg("adiliHours", hours?c), linkExpirationFormatter(linkExpiration))>
  <#local firstName = (user.firstName)!"">
  <#return {
    "invited": invited,
    "commission": commission,
    "commissionLabel": message("adiliDetailCommission." + roleCode, msg("adiliDetailCommission")),
    "roleTitle": roleTitle,
    "duty": message("adiliRoleDuty." + roleCode, ""),
    "greeting": firstName?has_content?then(msg("adiliGreetingName", firstName), msg("adiliGreeting")),
    "steps": steps,
    "expiry": expiry,
    "preheader": invited?then(msg("adiliInvitePreheader", roleTitle, commission, expiry), msg("adiliSetupPreheader", expiry))
  }>
</#function>

<#-- The message for `key`, or `fallback` when the theme has no such message. -->
<#function message key fallback>
  <#local text = msg(key)>
  <#return (text == key)?then(fallback, text)>
</#function>
